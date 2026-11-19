# 🎨 Pixelary

A chaotic multiplayer guessing game. You draw on a pixel grid (8×8, 9×9, 16×16 or 17×17) **with words**, not a brush.

```
yellow circle big 28          → a big filled yellow circle
red ring 46                   → a small red outline of a circle
black cells 19, 21            → just those two cells
black line col 1 to 57        → a straight line down the left edge
green row 64                  → the whole bottom row
grumpy 1                      → 🎲 a random color in the top-left corner
```

## How to play

1. The host creates a game and sends the invite link (`…/?room=ABCD`).
2. Everyone joins and hits **Ready**. The host picks the settings (rounds, seconds per turn or **no timer**, how long the answer is shown, grid size 8×8, 9×9, 16×16 or 17×17 (odd sizes have a true center cell, so centered shapes are easier), word difficulty: easy, medium, hard or mix it up) and starts the game.
3. Players take turns drawing a secret word. Everyone else types guesses.
4. A turn ends when time runs out or everyone has guessed it. The word is then shown for 10 seconds.
5. **No-timer games:** a turn ends when everyone has guessed, or when the drawer or host hits **🏁 End turn**.
6. **Save the art:** during the reveal, hit **💾 Save drawing** for a PNG of that picture. At the end, the gallery shows every drawing, with **Save round** and **Save all** buttons. Images include the Pixelary title, each word and the artist's name.
7. Stuck with a word? The drawer can hit **⏭️ Skip word** for a new word and a blank grid, any time before someone guesses. The timer keeps running.

### Drawing commands

`color [shape] [size] cells`. The words can come in any order, and filler words like "in", "at" and "cells" are ignored.

| Part  | Options |
|-------|---------|
| color | Any color word, including colorful things like `lava` or `sky blue`. Words it doesn't know get a **random** color. `blue all` fills the whole grid. Use `clear` (or `erase`) to remove color: `clear 12`, `clear row 9`, or `clear all` to wipe the grid. |
| shape | `dot` (default), `square`, `box`, `circle` (filled), `ring` (outline), `plus`, `x`, `line`, `row`, `col`/`column`, `diamond`, `triangle` |
| size  | `small` (3×3, default), `big` (5×5), `huge` (9×9), or a number right after the shape: `beige square 3 50` (or `3x3`) is a 3×3 square centered on cell 50. Shapes are cut off at the grid edge; they never wrap to the other side. |
| cells | `13`: one cell, with the shape centered on it. `1, 6, 11`: a list, each cell painted (shapes like `square` are stamped on each; use commas so `plus 7, 19` isn't read as "size 7 at 19"). `1 to 21` or `1-21`: a straight line between two cells, including diagonals. Cells are numbered left to right from 1 in the top-left: up to 64 on 8×8, 81 on 9×9, 256 on 16×16, 289 on 17×17. Spoken numbers like "thirteen" also work. |

`row` or `col` with a single cell and no size fills that **whole** row or column. Add a size (`col small 28`) to get a short segment instead.

🎤 **Voice input (experimental):** in Chrome, Edge or Safari, tap the mic and say the command.

### Scoring

- **Guesser:** 50–100 points. The faster you guess, the more you get. With no timer, it goes by order instead: 100, 80, 60, then 50.
- **Drawer:** +25 for each player who guesses correctly.

Wrong guesses are shown to everyone. Correct guesses are never shown.

## Run locally

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # restarts automatically when files change
npm test
```

To try multiplayer on one computer, open the game in a normal window and in a private/incognito window.

## Deploy (Render, free)

1. Push this repo to GitHub.
2. On [render.com](https://render.com), go to **New → Blueprint** and pick this repo. Render reads `render.yaml`.
3. Share `https://<your-app>.onrender.com`.

Things to know:

- **Cold starts:** after about 15 minutes with no visitors, the free tier puts the server to sleep. The next visitor waits about 30–50 seconds while it starts again. To avoid the wait, open the link a minute before you play, or upgrade to the Starter plan.
- **Game state is kept in memory**, so a redeploy or restart ends any games in progress. Only one instance should run.
- **Alternatives:** Fly.io (fast WebSockets, no long sleeps; needs the CLI) or Railway (deploys from GitHub, usage-based pricing). Both work as-is because the server reads `PORT` from the environment.

## Project layout

```
server/
  index.js          Express + Socket.IO wiring
  rooms.js          lobby/game state machine, timers, scoring
  commandParser.js  "lime square big 13" → color + cells
  colors.js         color interpreter (word → hex)
  words.js          random word picker (words.json)
public/             static client (index.html, app.js, art.js for PNG export, style.css)
test/               node:test unit tests + end-to-end socket test
```

## Ideas for later

- Hidden-canvas mode, where the drawer can't see the grid until the turn ends
- Letter-based cell names
