# B 站投稿材料（Demo 视频）

- 视频文件：`~/spotfoundry-upload/spotfoundry-demo.mp4`（1920×1080，4 分 36 秒，由 `scripts/demo-reel.py` 从仓库产物生成，含两段真实操作录屏：Studio 网页工作台，以及 DeepSeek Harness 通过 Skill 调用）
- 封面：`~/spotfoundry-upload/bilibili-cover.jpg`（1920×1080）
- 分区：科技 → 人工智能
- 类型：自制

## 标题

一句话生成一支广告片：在一台 DGX Spark 上跑通的广告工作室智能体｜Spotfoundry 广告工坊

## 简介

Spotfoundry（广告工坊）是贺家豪为第三届 NVIDIA DGX Spark 黑客松 · Agent Skills 开发挑战赛做的作品：你说一句创意，它交付一支画面、配音、音乐、字幕齐全且文案合规的短视频广告，全程在一台 DGX Spark 上生成。

· 自研 Spotfoundry Harness：需求、脚本、合规、分镜、生图、质检、生视频、成片八个阶段，每个阶段一个加载 Agent Skill 的子智能体，代码管顺序和验收，模型管判断
· NVIDIA Nemotron 3.5 Lightning（NVFP4 + DSpark 投机解码）写文案和提示词；StepFun Step3-VL 逐帧质检；Qwen-Image、Wan2.2 14B、ACE-Step、Qwen3-TTS 本地出图、出片、出配乐和配音
· 先出产品定妆图再出每一帧，整支片子是同一个产品；画面不让模型写字，字幕后期真字体排版；广告法用词扫描加独立审稿
· 同一模型同一批创意，带 Skill 后分镜一次合格率从 0/16 提升到 8/14
· 可被任何支持 Agent Skills 的智能体调用：视频里 DeepSeek Harness 由本机 NVIDIA Nemotron 驱动，加载 spotfoundry-ad-film Skill 后自动出片
· 配音为按文字描述设计的旁白音色（Qwen3-TTS），不取自任何真人

视频中的四支样片（饮料、数码、护肤、食品）和所有数字均为本机实测。
源码仓库：https://github.com/hojiahao/spotfoundry

## 分段章节

00:00 Spotfoundry 广告工坊
00:07 做一条短视频广告，卡在哪里
00:30 两种开拍方式，同一个 Spotfoundry Harness
00:54 方式一：Studio 网页工作台（实录）
01:34 方式二：DeepSeek Harness 通过 Skill 调用（本地 Nemotron，实录）
02:16 先审后生成：文案过三道关
02:37 定妆图与质检闭环
03:00 四支成片
04:08 证据：带与不带 Skill 的对比、实测耗时
04:26 收尾

## 标签

NVIDIA, DGX Spark, 黑客松, Agent Skills, AI 智能体, AI 视频, 广告, Nemotron, 阶跃星辰, StepFun, ComfyUI
