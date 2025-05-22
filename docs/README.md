# Microsoft To Do Sync 文档

## 文档目录

1. [功能模块概述](功能模块概述.md) - 概述插件的主要功能模块和结构
2. [功能流程图](功能流程图.md) - 使用 Mermaid 图表展示各种功能流程
3. [技术实现详解](技术实现详解.md) - 详细解释插件的技术实现
4. [认证与API集成模块](认证与API集成模块.md) - 详细介绍认证流程和认证信息持久化

## 项目简介

这是一个 Obsidian 插件，用于同步 Obsidian 中的任务与 Microsoft To Do 服务。插件支持双向同步，允许用户在 Obsidian 中创建任务并同步到 Microsoft To Do，或者从 Microsoft To Do 获取任务显示在 Obsidian 中。

## 主要功能

- 在 Obsidian 中创建任务并推送到 Microsoft To Do
- 从 Microsoft To Do 获取任务并显示在 Obsidian 中
- 支持任务状态、重要性、截止日期等属性的同步
- 支持任务与子任务的同步
- 提供增量同步机制以提高性能
- 丰富的自定义选项 