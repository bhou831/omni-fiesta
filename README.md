# Omni Fiesta

A party game engine for friends in the same room: one host, everyone's phones, and a shared TV screen. Guests join by QR code, play with virtual tokens, and follow the host through each round. No app installation needed.

The current party celebrates Tracy's 10,000th day, with a simple notebook-style interface, balloons, and fireworks.

## The games

| Round                   | What happens                                                                    |
| ----------------------- | ------------------------------------------------------------------------------- |
| Quantitative researcher | Research five assets and invest tokens before the timer ends.                   |
| Best dressed            | Vote for a favorite costume; prizes are revealed near the end.                  |
| Jeopardy · 团队抢答     | Pick from a Chinese question board, buzz on phones, and answer aloud as a team. |
| Tonight I am Venetian   | Try up to three optional slot-machine spins.                                    |
| Powerball red or blue   | Bet tokens on a color and watch the draw.                                       |
| The closing bell        | See market moves and settle investment gains or losses.                         |
| Somebody's calling      | The host privately draws a guest, calls them, and reveals the prize.            |
| The finale              | Reveal costume awards and the full party ranking.                               |

Only the host advances rounds. Timed rounds start when the host clicks **Start timer**; an expired timer closes submissions without moving everyone forward.

## Run locally

Requires Node.js **22.13 or newer**.

```sh
npm ci
npm run setup
npm run dev
```

Open **http://localhost:3000**. Setup creates a private `.env` file containing your `HOST_PASSWORD`; an existing `.env` is preserved.

## Host a party

1. Open **`/host`**, sign in, and create a party.
2. Open **`/screen`** on the TV computer, sign in, and select the same room code.
3. Guests scan the lobby QR code, choose a name and emoji, and mark themselves ready. Phone numbers are required for Somebody's calling; email is optional.
4. Prepare opening market prices, then use the host controls to start and run each round.

The host can use a phone or iPad while a separate Mac projects the TV view over HDMI. Both devices can stay signed in. Project `/screen`; `/host` contains private controls and player information. Players use `/play`, with their token balance hidden until tapped.

For phone testing on the same Wi-Fi, open the computer's LAN address on every device instead of `localhost`. Use your HTTPS domain for a hosted party.

Players can refresh or reconnect without losing progress. If someone loses their session, use the host roster's recovery controls. New registrations close after the lobby. To hide an unused room, choose **Manage parties → Archive party** after its players disconnect; it can be restored later.

## Try a game without playing the whole party

```sh
just preview                   # Gallery with player, host, and TV links
just preview trivia            # Jump straight to Jeopardy
just preview trivia-scoreboard # Team rankings
just preview stock             # Investment cards
just preview slots             # Slot machine
```

Open **http://127.0.0.1:3001/preview**. These are disposable sample rooms with fixture prices; restarting resets them. Without `just`, use `npm run preview -- trivia`.

For practice through the normal host interface, **Manage parties → Test tools** offers **Connection check** and **Full test party** when rehearsal support is enabled.

## Make it your party

- **Rules and rewards:** edit [config/game.yaml](config/game.yaml) for token amounts, timers, investment settings, prizes, and odds. New rooms use the updated settings; existing rooms keep their saved configuration.
- **Live investments:** set `COINGECKO_API_KEY` in your private `.env`, then run `just market-check` to check the five configured assets.
- **Your Jeopardy questions:** a demo bank is included. Set `TRIVIA_BANK_FILE` in `.env` to your private JSON file, then validate with `npm run trivia:check`. See [question banks and the host demo switch](docs/games/trivia.md#demo-versus-event-content-2026-10-29) before starting a new party.
- **Saved parties:** progress is stored in `data/party.sqlite` by default. Keep the database and `.env` when restarting the server.

## Useful commands

Run `just` to list all shortcuts.

| Command                     | Purpose                                             |
| --------------------------- | --------------------------------------------------- |
| `just dev`                  | Start the development server.                       |
| `just preview [game]`       | Preview a game with sample players.                 |
| `just format`               | Format source files.                                |
| `just check`                | Run formatting checks, tests, typecheck, and build. |
| `just build` / `just start` | Build and run the application.                      |

## Explore the design

- [Architecture walkthrough](docs/system-architecture.html) — open the HTML in a browser.
- [Product specification](spec.md) and [individual game rules](docs/games/).
- [Visual design system](docs/design/visual-system.md).
- [System design](docs/system.md) — state, synchronization, accounting, and privacy.
- [Hosting and backups](docs/deployment.md) — AWS Lightsail deployment.
- [Implementation status and verification](docs/plan.md).

Built with TypeScript, React, Node.js, Socket.IO, and SQLite.
