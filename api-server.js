const express = require('express');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('./swagger.json');
const cors = require('cors');
const path = require('path');
const todoApiRoutes = require('./routes/todo-api');

const app = express();
const PORT = process.env.PORT || 3000;

// 请求日志中间件
app.use((req, res, next) => {
  const start = Date.now();
  const requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
  
  console.log(`[${requestId}] 收到请求: ${req.method} ${req.url}, 时间=${new Date().toISOString()}`);
  console.log(`[${requestId}] 请求头: ${JSON.stringify(req.headers)}`);
  
  // 截获原始的res.json方法
  const originalJson = res.json;
  res.json = function(data) {
    console.log(`[${requestId}] 响应JSON数据: ${typeof data === 'object' ? '对象' : typeof data}, 长度=${JSON.stringify(data).length}`);
    if (data && typeof data === 'object') {
      if (data.accessToken) {
        console.log(`[${requestId}] 响应中包含accessToken, 长度=${data.accessToken.length}`);
      }
    }
    return originalJson.call(this, data);
  };
  
  // 捕获响应完成事件
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[${requestId}] 请求完成: ${req.method} ${req.url} - 状态: ${res.statusCode} - 耗时: ${duration}ms, 时间=${new Date().toISOString()}`);
  });
  
  // 添加请求ID到响应头
  res.setHeader('X-Request-ID', requestId);
  next();
});

// CORS配置
const corsOptions = {
  exposedHeaders: ['Content-Type', 'X-Request-ID'],
  credentials: true,
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID', 'Accept', 'Cache-Control', 'Pragma']
};
app.use(cors(corsOptions));

// 在OPTIONS预检请求中添加明确的状态码和响应
app.options('*', cors(corsOptions));

// JSON解析中间件
app.use(express.json({
  verify: (req, res, buf, encoding) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({ message: '无效的JSON格式', error: e.message });
      throw new Error('无效的JSON格式');
    }
  }
}));
app.use(express.urlencoded({ extended: true }));

// 禁用缓存中间件
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
});

// 响应头设置中间件 - 确保Content-Type正确
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function(body) {
    // JSON响应应该有正确的Content-Type
    if (body && typeof body === 'string' && body.startsWith('{') && !res.get('Content-Type')) {
      res.set('Content-Type', 'application/json');
    }
    return originalSend.call(this, body);
  };
  next();
});

// 静态文件
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  lastModified: false,
  setHeaders: (res, path) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
  }
}));

// Swagger UI的认证脚本
const swaggerUIOptions = {
  swaggerOptions: {
    onComplete: function() {
      // 当Swagger UI完成加载时，检查本地存储中的令牌
      var accessToken = localStorage.getItem('msft_access_token');
      if (accessToken) {
        // 如果存在令牌，自动设置到认证
        ui.preauthorizeApiKey('bearerAuth', accessToken);
      }
    }
  },
  customCss: '.swagger-ui .topbar { display: none }',
  customJs: '/swagger-custom.js'  // 自定义JS以添加认证支持
};

// API 文档
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerUIOptions));

// API 路由
app.use('/api/todo', todoApiRoutes);

// 认证路由 - 直接提供认证页面
app.get('/auth', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'auth.html'));
});

// 首页重定向到API文档
app.get('/', (req, res) => {
  res.redirect('/api-docs');
});

// 404错误处理
app.use((req, res, next) => {
  res.status(404).json({
    message: '未找到请求的资源',
    path: req.originalUrl
  });
});

// 错误处理中间件
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    message: '服务器内部错误',
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// 捕获未处理的promise rejection
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise rejection:', reason);
});

// 捕获全局异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Microsoft To Do API测试服务器运行在: http://localhost:${PORT}`);
  console.log(`Swagger UI可访问: http://localhost:${PORT}/api-docs`);
  console.log(`认证页面可访问: http://localhost:${PORT}/auth`);
}); 