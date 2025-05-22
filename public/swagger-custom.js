// 等待Swagger UI完全加载
window.addEventListener('load', function() {
  // 确保UI已加载
  const checkSwagger = setInterval(() => {
    if (window.ui) {
      clearInterval(checkSwagger);
      initCustomAuth();
    }
  }, 100);
});

function initCustomAuth() {
  console.log('初始化Swagger UI自定义认证');

  // 检查本地存储中的令牌
  const accessToken = localStorage.getItem('msft_access_token');
  
  // 如果已经有令牌，自动设置认证
  if (accessToken) {
    try {
      window.ui.preauthorizeApiKey('bearerAuth', accessToken);
      console.log('已从本地存储自动设置令牌');
      
      // 添加已授权标志
      addAuthBadge(true);
    } catch (error) {
      console.error('设置令牌时出错:', error);
    }
  } else {
    // 添加未授权标志
    addAuthBadge(false);
  }
  
  // 添加自定义认证按钮
  addCustomAuthButton();
}

// 添加认证状态徽章
function addAuthBadge(isAuthorized) {
  // 删除现有徽章
  const existingBadge = document.getElementById('ms-auth-badge');
  if (existingBadge) {
    existingBadge.remove();
  }
  
  // 创建新徽章
  const badge = document.createElement('div');
  badge.id = 'ms-auth-badge';
  badge.style.position = 'fixed';
  badge.style.top = '10px';
  badge.style.right = '10px';
  badge.style.padding = '5px 10px';
  badge.style.borderRadius = '20px';
  badge.style.color = 'white';
  badge.style.fontWeight = 'bold';
  badge.style.fontSize = '12px';
  badge.style.zIndex = '9999';
  
  if (isAuthorized) {
    badge.textContent = '已授权';
    badge.style.backgroundColor = '#4CAF50';
  } else {
    badge.textContent = '未授权';
    badge.style.backgroundColor = '#F44336';
  }
  
  document.body.appendChild(badge);
}

// 添加自定义认证按钮
function addCustomAuthButton() {
  // 等待Swagger UI顶部栏加载完成
  const checkTopbar = setInterval(() => {
    const topbar = document.querySelector('.swagger-ui .topbar');
    if (topbar) {
      clearInterval(checkTopbar);
      
      // 创建认证按钮
      const authButton = document.createElement('button');
      authButton.textContent = '微软认证';
      authButton.className = 'ms-auth-button';
      authButton.style.background = '#0078d4';
      authButton.style.color = 'white';
      authButton.style.border = 'none';
      authButton.style.borderRadius = '4px';
      authButton.style.padding = '10px 15px';
      authButton.style.cursor = 'pointer';
      authButton.style.margin = '10px';
      authButton.style.fontWeight = 'bold';
      
      // 点击事件 - 打开认证页面
      authButton.addEventListener('click', () => {
        window.location.href = '/auth';
      });
      
      // 添加到顶部栏
      topbar.appendChild(authButton);
      
      // 使顶部栏可见
      topbar.style.display = 'flex';
      topbar.style.justifyContent = 'flex-end';
      topbar.style.alignItems = 'center';
      topbar.style.padding = '10px';
    }
  }, 100);
  
  // 添加注销按钮
  const checkInfo = setInterval(() => {
    const infoContainer = document.querySelector('.swagger-ui .info');
    if (infoContainer) {
      clearInterval(checkInfo);
      
      // 创建注销按钮
      const logoutButton = document.createElement('button');
      logoutButton.textContent = '清除认证状态';
      logoutButton.className = 'ms-logout-button';
      logoutButton.style.background = '#f0f0f0';
      logoutButton.style.color = '#333';
      logoutButton.style.border = '1px solid #ddd';
      logoutButton.style.borderRadius = '4px';
      logoutButton.style.padding = '8px 12px';
      logoutButton.style.cursor = 'pointer';
      logoutButton.style.margin = '10px 0';
      logoutButton.style.fontSize = '14px';
      
      // 点击事件 - 清除认证
      logoutButton.addEventListener('click', () => {
        localStorage.removeItem('msft_access_token');
        window.ui.authActions.logout(['bearerAuth']);
        addAuthBadge(false);
        alert('认证状态已清除');
      });
      
      // 添加到信息容器
      infoContainer.appendChild(logoutButton);
    }
  }, 100);
  
  // 添加用户提示
  const checkSchemes = setInterval(() => {
    const authContainer = document.querySelector('.swagger-ui .auth-wrapper .authorize');
    if (authContainer) {
      clearInterval(checkSchemes);
      
      // 创建提示容器
      const tipContainer = document.createElement('div');
      tipContainer.style.padding = '10px';
      tipContainer.style.margin = '10px 0';
      tipContainer.style.backgroundColor = '#E3F2FD';
      tipContainer.style.borderRadius = '4px';
      tipContainer.style.fontSize = '14px';
      
      // 提示内容
      tipContainer.innerHTML = `
        <p style="margin: 0 0 10px 0;"><strong>使用指南：</strong></p>
        <ol style="margin: 0 0 0 20px; padding: 0;">
          <li>点击页面顶部的<strong>微软认证</strong>按钮，完成Microsoft账号授权</li>
          <li>授权成功后，所有API将自动获得访问权限</li>
          <li>如需清除认证状态，请点击上方的<strong>清除认证状态</strong>按钮</li>
        </ol>
      `;
      
      // 添加到认证容器前面
      authContainer.parentNode.insertBefore(tipContainer, authContainer);
    }
  }, 100);
}

// 监听身份验证状态变化
window.addEventListener('storage', function(event) {
  if (event.key === 'msft_access_token') {
    const newToken = event.newValue;
    if (newToken) {
      window.ui.preauthorizeApiKey('bearerAuth', newToken);
      addAuthBadge(true);
    } else {
      window.ui.authActions.logout(['bearerAuth']);
      addAuthBadge(false);
    }
  }
}); 