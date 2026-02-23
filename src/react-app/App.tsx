import { useState, useEffect, useCallback, useRef } from "react";
import "./App.css";

type TileState = "correct" | "present" | "absent" | "empty" | "tbd";

interface GuessRow {
  letters: string[];
  states: TileState[];
}

interface SavedState {
  gameNumber: number;
  guesses: GuessRow[];
  keyStates: Record<string, TileState>;
  solved: boolean;
  startTime: number | null;
  elapsed: number;
}

const STORAGE_KEY = "fastle-state";

function loadState(): SavedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveState(state: SavedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const KEYBOARD_ROWS = [
  ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l"],
  ["Enter", "z", "x", "c", "v", "b", "n", "m", "⌫"],
];

function App() {
  const [guesses, setGuesses] = useState<GuessRow[]>([]);
  const [currentGuess, setCurrentGuess] = useState("");
  const [gameNumber, setGameNumber] = useState<number | null>(null);
  const [solved, setSolved] = useState(false);
  const [error, setError] = useState("");
  const [shaking, setShaking] = useState(false);
  const [revealingRow, setRevealingRow] = useState(-1);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [keyStates, setKeyStates] = useState<Record<string, TileState>>({});
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fastestTime, setFastestTime] = useState<number | null>(null);
  const [fastestGuesses, setFastestGuesses] = useState<number | null>(null);
  const [countdown, setCountdown] = useState("");
  const [loaded, setLoaded] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);

  // Fetch game number and restore state
  useEffect(() => {
    fetch("/api/game")
      .then((r) => r.json())
      .then((d: { gameNumber: number }) => {
        const gn = d.gameNumber;
        setGameNumber(gn);

        const saved = loadState();
        if (saved && saved.gameNumber === gn) {
          setGuesses(saved.guesses);
          setKeyStates(saved.keyStates);
          setSolved(saved.solved);
          setStartTime(saved.startTime);
          setElapsed(saved.elapsed);
          if (saved.solved) {
            // Fetch fastest time if already solved
            fetch(`/api/fastest/${gn}`)
              .then((r) => r.json())
              .then((data: { fastestTimeMs: number | null; fastestGuesses: number | null }) => {
                setFastestTime(data.fastestTimeMs);
                setFastestGuesses(data.fastestGuesses);
              });
          }
        }
        setLoaded(true);
      });
  }, []);

  // Timer: if not solved and we have a startTime, keep ticking based on wall clock
  useEffect(() => {
    if (!loaded || !startTime || solved) return;
    const tick = () => setElapsed(Date.now() - startTime);
    tick();
    const interval = setInterval(tick, 10);
    return () => clearInterval(interval);
  }, [startTime, solved, loaded]);

  // Countdown to next word (midnight UTC)
  useEffect(() => {
    if (!solved) return;
    const update = () => {
      const now = new Date();
      const tomorrow = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)
      );
      const diff = tomorrow.getTime() - now.getTime();
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setCountdown(
        `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [solved]);

  // Persist state to localStorage
  useEffect(() => {
    if (gameNumber === null || !loaded) return;
    saveState({ gameNumber, guesses, keyStates, solved, startTime, elapsed });
  }, [gameNumber, guesses, keyStates, solved, startTime, elapsed, loaded]);

  // Auto-scroll to latest guess
  useEffect(() => {
    if (boardRef.current) {
      boardRef.current.scrollTop = boardRef.current.scrollHeight;
    }
  }, [guesses]);

  const showError = useCallback((msg: string) => {
    setError(msg);
    setShaking(true);
    setTimeout(() => setShaking(false), 600);
    setTimeout(() => setError(""), 1500);
  }, []);

  const submitGuess = useCallback(async () => {
    if (currentGuess.length !== 5 || solved || submitting || gameNumber === null) return;

    const now = Date.now();
    const st = startTime ?? now;
    if (!startTime) setStartTime(st);
    setSubmitting(true);

    try {
      const res = await fetch("/api/guess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guess: currentGuess }),
      });
      const data = (await res.json()) as {
        result?: TileState[];
        solved?: boolean;
        error?: string;
      };

      if (data.error) {
        showError(data.error);
        setSubmitting(false);
        return;
      }

      const newRow: GuessRow = {
        letters: currentGuess.split(""),
        states: data.result!,
      };

      const newGuesses = [...guesses, newRow];
      const newIndex = guesses.length;
      setGuesses(newGuesses);
      setRevealingRow(newIndex);
      setCurrentGuess("");

      // Update keyboard states
      setKeyStates((prev) => {
        const next = { ...prev };
        for (let i = 0; i < 5; i++) {
          const letter = newRow.letters[i];
          const state = newRow.states[i];
          const existing = next[letter];
          if (state === "correct") {
            next[letter] = "correct";
          } else if (state === "present" && existing !== "correct") {
            next[letter] = "present";
          } else if (!existing) {
            next[letter] = state;
          }
        }
        return next;
      });

      // Wait for reveal animation before marking solved
      setTimeout(() => {
        setRevealingRow(-1);
        if (data.solved) {
          const finalElapsed = Date.now() - st;
          setElapsed(finalElapsed);
          setSolved(true);

          // Submit time to leaderboard
          fetch("/api/solve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              gameNumber,
              timeMs: finalElapsed,
              numGuesses: newGuesses.length,
            }),
          })
            .then((r) => r.json())
            .then(
              (d: { fastestTimeMs: number | null; fastestGuesses: number | null }) => {
                setFastestTime(d.fastestTimeMs);
                setFastestGuesses(d.fastestGuesses);
              }
            );
        }
        setSubmitting(false);
      }, 5 * 200 + 300);
    } catch {
      showError("Connection error");
      setSubmitting(false);
    }
  }, [currentGuess, solved, submitting, startTime, guesses, gameNumber, showError]);

  const handleKey = useCallback(
    (key: string) => {
      if (solved) return;
      if (key === "Enter") {
        submitGuess();
      } else if (key === "Backspace" || key === "⌫") {
        setCurrentGuess((prev) => prev.slice(0, -1));
      } else if (/^[a-zA-Z]$/.test(key) && currentGuess.length < 5) {
        if (!startTime) setStartTime(Date.now());
        setCurrentGuess((prev) => prev + key.toLowerCase());
      }
    },
    [solved, submitGuess, currentGuess.length, startTime]
  );

  // Physical keyboard
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      handleKey(e.key);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleKey]);

  const formatTime = (ms: number) => {
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(2)}s`;
    const mins = Math.floor(totalSeconds / 60);
    const secs = (totalSeconds % 60).toFixed(2);
    return `${mins}:${secs.padStart(5, "0")}`;
  };

  const share = () => {
    const grid = guesses
      .map((row) =>
        row.states
          .map((s) => (s === "correct" ? "🟩" : s === "present" ? "🟨" : "⬛"))
          .join("")
      )
      .join("\n");
    const text = `Fastle #${gameNumber} - ${formatTime(elapsed)} (${guesses.length} ${guesses.length === 1 ? "guess" : "guesses"})\n\n${grid}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!loaded) return null;

  const currentRow = Array(5)
    .fill("")
    .map((_, i) => currentGuess[i] || "");

  return (
    <div className="page">
      <div className="top-bar">
        <a className="top-bar-left" href="https://fling.so" target="_blank" rel="noopener noreferrer">
          <img src="/fling.svg" alt="Fling" className="fling-logo" />
          <span>Made with Fling</span>
        </a>
        <a className="top-bar-right" href="mailto:mark@glideapps.com">Contact</a>
      </div>
      <div className="game">
      <header className="header">
        <h1>Fastle</h1>
        <div className="timer">{formatTime(elapsed)}</div>
      </header>

      {error && <div className="toast">{error}</div>}

      <div className="board" ref={boardRef}>
        {guesses.map((row, ri) => (
          <div key={ri} className={`row${revealingRow === ri ? " revealing" : ""}`}>
            {row.letters.map((letter, li) => (
              <div
                key={li}
                className={`tile ${row.states[li]}`}
                style={
                  revealingRow === ri ? { animationDelay: `${li * 200}ms` } : undefined
                }
              >
                {letter}
              </div>
            ))}
          </div>
        ))}
        {!solved && (
          <div className={`row${shaking ? " shake" : ""}`}>
            {currentRow.map((letter, i) => (
              <div key={i} className={`tile${letter ? " tbd" : ""}`}>
                {letter}
              </div>
            ))}
          </div>
        )}
      </div>

      {solved && (
        <div className="win-banner">
          <p>
            Solved in <strong>{formatTime(elapsed)}</strong> with{" "}
            <strong>
              {guesses.length} {guesses.length === 1 ? "guess" : "guesses"}
            </strong>
          </p>
          {fastestTime !== null && (
            <p className="fastest-time">
              Fastest today: <strong>{formatTime(fastestTime)}</strong> in{" "}
              {fastestGuesses} {fastestGuesses === 1 ? "guess" : "guesses"}
            </p>
          )}
          <div className="win-actions">
            <button className="share-btn" onClick={share}>
              {copied ? "Copied!" : "Share"}
            </button>
          </div>
          <p className="countdown">Next word in {countdown}</p>
        </div>
      )}

      {!solved && guesses.length === 0 && (
        <p className="instructions">
          Guess the word as fast as you can! Unlimited guesses — the clock starts when you type.
        </p>
      )}

      <div className="keyboard">
        {KEYBOARD_ROWS.map((row, ri) => (
          <div key={ri} className="keyboard-row">
            {row.map((key) => (
              <button
                key={key}
                className={`key ${keyStates[key] || ""} ${key.length > 1 ? "wide" : ""}`}
                onClick={() => handleKey(key === "⌫" ? "Backspace" : key)}
              >
                {key}
              </button>
            ))}
          </div>
        ))}
      </div>
      </div>
    </div>
  );
}

export default App;
