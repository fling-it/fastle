import { app, migrate, db } from "flingit";
import { WORDS } from "./words";

const WORD_SET = new Set(WORDS);

migrate("001_create_fastest_times", async () => {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS fastest_times (
      game_number INTEGER PRIMARY KEY,
      time_ms INTEGER NOT NULL,
      num_guesses INTEGER NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `).run();
});

function getDailyWord(): string {
  const today = new Date();
  const dateStr = `${today.getUTCFullYear()}-${today.getUTCMonth() + 1}-${today.getUTCDate()}`;
  let hash = 0;
  for (let i = 0; i < dateStr.length; i++) {
    hash = ((hash << 5) - hash) + dateStr.charCodeAt(i);
    hash |= 0;
  }
  return WORDS[Math.abs(hash) % WORDS.length];
}

function getGameNumber(): number {
  const start = new Date("2025-01-01T00:00:00Z");
  const now = new Date();
  return Math.floor((now.getTime() - start.getTime()) / 86400000);
}

function evaluate(guess: string, answer: string): string[] {
  const result = Array(5).fill("absent");
  const answerLetters = answer.split("");
  const guessLetters = guess.split("");

  for (let i = 0; i < 5; i++) {
    if (guessLetters[i] === answerLetters[i]) {
      result[i] = "correct";
      answerLetters[i] = "_";
      guessLetters[i] = "_";
    }
  }

  for (let i = 0; i < 5; i++) {
    if (guessLetters[i] === "_") continue;
    const idx = answerLetters.indexOf(guessLetters[i]);
    if (idx !== -1) {
      result[i] = "present";
      answerLetters[idx] = "_";
    }
  }

  return result;
}

app.get("/api/game", (c) => {
  return c.json({ gameNumber: getGameNumber() });
});

app.post("/api/guess", async (c) => {
  const { guess } = await c.req.json<{ guess: string }>();
  const word = guess.toLowerCase().trim();

  if (word.length !== 5) {
    return c.json({ error: "Word must be 5 letters" }, 400);
  }

  if (!WORD_SET.has(word)) {
    return c.json({ error: "Not in word list" }, 400);
  }

  const answer = getDailyWord();
  const result = evaluate(word, answer);
  const solved = word === answer;

  return c.json({ result, solved });
});

app.post("/api/solve", async (c) => {
  const { gameNumber, timeMs, numGuesses } = await c.req.json<{
    gameNumber: number;
    timeMs: number;
    numGuesses: number;
  }>();

  const current = await db
    .prepare("SELECT time_ms FROM fastest_times WHERE game_number = ?")
    .bind(gameNumber)
    .first<{ time_ms: number }>();

  if (!current || timeMs < current.time_ms) {
    await db
      .prepare(
        "INSERT OR REPLACE INTO fastest_times (game_number, time_ms, num_guesses) VALUES (?, ?, ?)"
      )
      .bind(gameNumber, timeMs, numGuesses)
      .run();
  }

  const fastest = await db
    .prepare("SELECT time_ms, num_guesses FROM fastest_times WHERE game_number = ?")
    .bind(gameNumber)
    .first<{ time_ms: number; num_guesses: number }>();

  return c.json({ fastestTimeMs: fastest?.time_ms ?? null, fastestGuesses: fastest?.num_guesses ?? null });
});

app.get("/api/fastest/:gameNumber", async (c) => {
  const gameNumber = parseInt(c.req.param("gameNumber"));
  const fastest = await db
    .prepare("SELECT time_ms, num_guesses FROM fastest_times WHERE game_number = ?")
    .bind(gameNumber)
    .first<{ time_ms: number; num_guesses: number }>();

  return c.json({ fastestTimeMs: fastest?.time_ms ?? null, fastestGuesses: fastest?.num_guesses ?? null });
});
