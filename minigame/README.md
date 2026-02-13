# WordWeaver WeChat Minigame

This directory contains the WeChat Minigame project structure for "AI 智学乐园" (AI Smart Learning Land).

## Structure
- `game.js`: The entry point for the Minigame.
- `game.json`: Global configuration.
- `project.config.json`: Project configuration for WeChat DevTools.

## How to Run
1. Open "WeChat DevTools" (微信开发者工具).
2. Select "Import Project" (导入项目).
3. Choose this `minigame` directory.
4. Set the AppID to `wx13922e8b755b1ece` (or your own).
5. The project is configured as a "Game" (小游戏).

## Development
Currently, `game.js` implements a basic Canvas-based "Hub" (Main Menu) that links to:
- English (WordWeaver)
- Math (Coming Soon)
- Chinese (Coming Soon)

To port the full WordWeaver game logic from the `frontend` (Next.js) folder to this Minigame, you will need to:
1. Re-implement the game logic in JavaScript/TypeScript compatible with the Minigame environment (no DOM).
2. Use the Canvas API or a game engine (like Cocos Creator or LayaAir) for rendering.
