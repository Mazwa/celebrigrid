const GRID_SIZE = 5;
const MAX_MISSES = 5;
const ACTOR_COUNT = 25;
const FAKE_ROUNDS = 10;
const FAKE_MOVIES_PER_ROUND = 10;
const SOLVER_ATTEMPTS = 220;
const SHARE_GAME_URL = "https://mazwa.github.io/celebrigrid/";
const DAILY_EPOCH_KEY = "2026-03-23";
const DAILY_BOARD_VERSION = 2;

const FAKE_ACTORS = Array.from({ length: ACTOR_COUNT }, (_, i) => `Actor ${String(i + 1).padStart(2, "0")}`);

const statusEl = document.getElementById("status");
const subtitleEl = document.getElementById("subtitle");
const gridEl = document.getElementById("grid");
const boardStageEl = document.getElementById("boardStage");
const missBarEl = document.getElementById("missBar");
const traceLayerEl = document.getElementById("traceLayer");
const popupLayerEl = document.getElementById("popupLayer");
const endgameModalEl = document.getElementById("endgameModal");
const closeEndgameBtn = document.getElementById("closeEndgameBtn");
const endgameMessageEl = document.getElementById("endgameMessage");
const endgameLinkEl = document.getElementById("endgameLink");
const shareDockEl = document.getElementById("shareDock");
const shareDockMessageEl = document.getElementById("shareDockMessage");
const shareDockLinkEl = document.getElementById("shareDockLink");
const shareBtnModal = document.getElementById("shareBtnModal");
const shareBtnDock = document.getElementById("shareBtnDock");

const runtime = {
  sourceType: "fake",
  sourceLabel: "built-in fake dataset",
  csvDataset: null
};

const state = {
  boardId: "",
  actorsByCell: [],
  sharedMoviesByPair: new Map(),
  currentIndex: 0,
  targetIndex: GRID_SIZE * GRID_SIZE - 1,
  missesLeft: MAX_MISSES,
  successMoves: 0,
  failedMoves: 0,
  finished: false,
  won: false,
  dayNumber: 1,
  dayDateKey: "",
  pathCells: [],
  traces: [],
  dragPreview: null,
  popups: [],
  nextPopupId: 1
};

const dirs = {
  ArrowUp: -GRID_SIZE,
  ArrowDown: GRID_SIZE,
  ArrowLeft: -1,
  ArrowRight: 1
};

function pairKey(a, b) {
  return a < b ? `${a}||${b}` : `${b}||${a}`;
}

function actorPhotoStem(name) {
  return name.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_]+/g, "");
}

function movieCreditKey(title, year) {
  const y = Number.isFinite(year) ? String(year) : "unknown";
  return `${title}@@${y}`;
}

function edgeKey(a, b) {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

function toCell(r, c) {
  return r * GRID_SIZE + c;
}

function rc(index) {
  return [Math.floor(index / GRID_SIZE), index % GRID_SIZE];
}

function isAdjacent(a, b) {
  const [ar, ac] = rc(a);
  const [br, bc] = rc(b);
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

function neighbors(index) {
  const [r, c] = rc(index);
  const out = [];
  if (r > 0) out.push(toCell(r - 1, c));
  if (r < GRID_SIZE - 1) out.push(toCell(r + 1, c));
  if (c > 0) out.push(toCell(r, c - 1));
  if (c < GRID_SIZE - 1) out.push(toCell(r, c + 1));
  return out;
}

function createSeededRng(seedText) {
  let state = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    state ^= seedText.charCodeAt(i);
    state = Math.imul(state, 16777619);
  }

  return function nextRandom() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng = Math.random) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function sampleShuffled(arr, n, rng = Math.random) {
  if (arr.length <= n) return shuffle([...arr], rng);
  return shuffle([...arr], rng).slice(0, n);
}

function setStatus(text, tone = "normal") {
  statusEl.textContent = text;
  statusEl.style.color = tone === "bad" ? "#b42318" : tone === "good" ? "#1f7a4a" : "#1d1f24";
}

function showEndgameModal(won) {
  const title = `CelebriGrid #${state.dayNumber}`;
  const msg = won ? "Success! You solved today's board." : "Game over. Better luck tomorrow.";
  endgameMessageEl.textContent = msg;
  endgameLinkEl.textContent = title;
  endgameLinkEl.href = SHARE_GAME_URL;
  shareDockMessageEl.textContent = msg;
  shareDockLinkEl.textContent = title;
  shareDockLinkEl.href = SHARE_GAME_URL;

  endgameModalEl.hidden = false;
  endgameModalEl.classList.add("visible");
  endgameModalEl.setAttribute("aria-hidden", "false");
  shareBtnModal.hidden = false;
  shareBtnModal.disabled = false;

  shareDockEl.hidden = true;
  shareDockEl.setAttribute("aria-hidden", "true");
  shareBtnDock.hidden = true;
  shareBtnDock.disabled = true;
}

function hideEndgameModal() {
  endgameModalEl.hidden = true;
  endgameModalEl.classList.remove("visible");
  endgameModalEl.setAttribute("aria-hidden", "true");
  shareBtnModal.hidden = true;
  shareBtnModal.disabled = true;
}

function closeEndgameModalToDock() {
  if (!state.finished) return;
  hideEndgameModal();
  shareDockEl.hidden = false;
  shareDockEl.setAttribute("aria-hidden", "false");
  shareBtnDock.hidden = false;
  shareBtnDock.disabled = false;
}

function todayKeyUtc() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseUtcDateKey(key) {
  const [y, m, d] = key.split("-").map((v) => Number.parseInt(v, 10));
  return Date.UTC(y, m - 1, d);
}

function dayIndexFromEpoch(todayKey) {
  const first = parseUtcDateKey(DAILY_EPOCH_KEY);
  const today = parseUtcDateKey(todayKey);
  const diffMs = today - first;
  const diffDays = Math.floor(diffMs / 86400000);
  return Math.max(1, diffDays + 1);
}

function loadDailyBoard() {
  const todayKey = todayKeyUtc();
  const dayNumber = dayIndexFromEpoch(todayKey);
  const seed = `${DAILY_BOARD_VERSION}:${todayKey}:${runtime.sourceType}:${runtime.csvDataset?.sharedPairCount || 0}`;
  const rng = createSeededRng(seed);
  const generated =
    runtime.sourceType === "csv" && runtime.csvDataset
      ? generateBoardFromDataset(runtime.csvDataset, rng)
      : generateFakeBoardState(rng);

  return {
    actorsByCell: generated.actorsByCell,
    path: generated.path,
    sharedMoviesByPair: generated.sharedMoviesByPair,
    dayNumber,
    dayDateKey: todayKey,
    source: "seeded"
  };
}

function generatePath(rng = Math.random) {
  const start = 0;
  const end = GRID_SIZE * GRID_SIZE - 1;
  const minLen = 10;
  let best = null;

  function dfs(current, visited, path) {
    if (current === end && path.length >= minLen) return path.slice();

    const candidates = shuffle(neighbors(current).filter((n) => !visited.has(n)), rng);
    for (const n of candidates) {
      visited.add(n);
      path.push(n);
      const result = dfs(n, visited, path);
      if (result) return result;
      path.pop();
      visited.delete(n);
    }

    if (!best || path.length > best.length) best = path.slice();
    return null;
  }

  for (let tries = 0; tries < 250; tries += 1) {
    const visited = new Set([start]);
    const path = [start];
    const result = dfs(start, visited, path);
    if (result) return result;
  }

  if (best && best[best.length - 1] === end) return best;
  throw new Error("Could not generate path from start to end.");
}

function buildCellEdgeConstraints(path) {
  const requiredEdges = new Set();
  for (let i = 0; i < path.length - 1; i += 1) {
    requiredEdges.add(edgeKey(path[i], path[i + 1]));
  }

  const forbiddenEdges = new Set();
  for (let cell = 0; cell < GRID_SIZE * GRID_SIZE; cell += 1) {
    for (const n of neighbors(cell)) {
      if (cell < n) {
        const k = edgeKey(cell, n);
        if (!requiredEdges.has(k)) forbiddenEdges.add(k);
      }
    }
  }

  return { requiredEdges, forbiddenEdges };
}

function countWinningPaths(actorsByCell, sharedMoviesByPair) {
  const start = 0;
  const end = GRID_SIZE * GRID_SIZE - 1;
  let count = 0;
  const visited = new Set([start]);

  function dfs(cell) {
    if (count > 1) return;
    if (cell === end) {
      count += 1;
      return;
    }

    for (const n of neighbors(cell)) {
      if (visited.has(n)) continue;
      const a = actorsByCell[cell];
      const b = actorsByCell[n];
      if (!sharedMoviesByPair.has(pairKey(a, b))) continue;
      visited.add(n);
      dfs(n);
      visited.delete(n);
    }
  }

  dfs(start);
  return count;
}

function normalizeCastMember(member) {
  if (typeof member === "string") {
    return { actor: member, roleSize: "large" };
  }

  return {
    actor: member.actor,
    roleSize: member.roleSize === "small" ? "small" : "large"
  };
}

function buildDatasetFromCastMaps(castByCredit) {
  const sharedMoviesByPair = new Map();
  const coStars = new Map();
  const actorSet = new Set();

  for (const credit of castByCredit.values()) {
    for (const rawMember of credit.cast) {
      const { actor } = normalizeCastMember(rawMember);
      actorSet.add(actor);
      if (!coStars.has(actor)) coStars.set(actor, new Set());
    }
  }

  for (const credit of castByCredit.values()) {
    const cast = [...credit.cast].map(normalizeCastMember);
    const year = credit.year ?? null;
    for (let i = 0; i < cast.length; i += 1) {
      for (let j = i + 1; j < cast.length; j += 1) {
        const a = cast[i];
        const b = cast[j];
        if (a.roleSize !== "large" || b.roleSize !== "large") continue;
        const key = pairKey(a.actor, b.actor);
        if (!sharedMoviesByPair.has(key)) sharedMoviesByPair.set(key, []);
        sharedMoviesByPair.get(key).push({ title: credit.title, year });
        coStars.get(a.actor).add(b.actor);
        coStars.get(b.actor).add(a.actor);
      }
    }
  }

  for (const list of sharedMoviesByPair.values()) {
    list.sort((a, b) => {
      const ay = Number.isFinite(a.year) ? a.year : 9999;
      const by = Number.isFinite(b.year) ? b.year : 9999;
      return ay - by || a.title.localeCompare(b.title);
    });
  }

  return {
    actors: [...actorSet],
    movies: castByCredit.size,
    sharedPairCount: sharedMoviesByPair.size,
    sharedMoviesByPair,
    coStars
  };
}

function parseCsvLine(line) {
  const out = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      out.push(current);
      current = "";
      continue;
    }

    current += ch;
  }

  out.push(current);
  return out;
}

function buildDatasetFromCsvText(csvText) {
  const lines = csvText.split(/\r?\n/);
  const castByCredit = new Map();

  let startIdx = 0;
  while (startIdx < lines.length && !lines[startIdx].trim()) startIdx += 1;
  if (startIdx >= lines.length) throw new Error("CSV is empty.");

  const first = parseCsvLine(lines[startIdx]).map((x) => x.trim().toLowerCase());
  const hasHeader =
    first.length >= 3 &&
    first[0] === "actor" &&
    first[1] === "movie" &&
    (first[2] === "movie_year" || first[2] === "year");
  const roleSizeIndex = hasHeader ? first.indexOf("role_size") : -1;

  const from = hasHeader ? startIdx + 1 : startIdx;
  for (let i = from; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    const cols = parseCsvLine(line);
    if (cols.length < 3) continue;

    const actor = cols[0].trim();
    const movie = cols[1].trim();
    const rawYear = cols[2].trim();
    const roleSize =
      roleSizeIndex >= 0 && roleSizeIndex < cols.length && cols[roleSizeIndex].trim().toLowerCase() === "small"
        ? "small"
        : "large";
    if (!actor || !movie) continue;

    const parsedYear = Number.parseInt(rawYear, 10);
    const movieYear = Number.isFinite(parsedYear) ? parsedYear : null;

    const creditKey = movieCreditKey(movie, movieYear);
    if (!castByCredit.has(creditKey)) {
      castByCredit.set(creditKey, { title: movie, year: movieYear, cast: new Set() });
    }
    castByCredit.get(creditKey).cast.add(JSON.stringify({ actor, roleSize }));
  }

  for (const credit of castByCredit.values()) {
    credit.cast = new Set([...credit.cast].map((member) => JSON.parse(member)));
  }

  return buildDatasetFromCastMaps(castByCredit);
}

function buildForbiddenAndRequired(path, actorsByCell) {
  const required = new Set();
  for (let i = 0; i < path.length - 1; i += 1) {
    required.add(pairKey(actorsByCell[path[i]], actorsByCell[path[i + 1]]));
  }

  const forbidden = new Set();
  for (let cell = 0; cell < GRID_SIZE * GRID_SIZE; cell += 1) {
    for (const n of neighbors(cell)) {
      if (cell < n) {
        const key = pairKey(actorsByCell[cell], actorsByCell[n]);
        if (!required.has(key)) forbidden.add(key);
      }
    }
  }

  return { required, forbidden };
}

function scheduleMovies(requiredPairs, forbiddenPairs, rng = Math.random) {
  const actorIdx = new Map(FAKE_ACTORS.map((a, i) => [a, i]));
  const required = [...requiredPairs].map((key) => key.split("||"));

  function conflict(actorA, actorB) {
    return forbiddenPairs.has(pairKey(actorA, actorB));
  }

  for (let attempt = 0; attempt < 300; attempt += 1) {
    const assign = Array.from({ length: ACTOR_COUNT }, () => Array(FAKE_ROUNDS).fill(-1));
    let valid = true;

    for (let round = 0; round < FAKE_ROUNDS && valid; round += 1) {
      const bins = Array.from({ length: FAKE_MOVIES_PER_ROUND }, () => []);
      const order = shuffle([...FAKE_ACTORS], rng);

      for (const actor of order) {
        const choices = [];
        for (let bin = 0; bin < FAKE_MOVIES_PER_ROUND; bin += 1) {
          const hasConflict = bins[bin].some((other) => conflict(actor, other));
          if (!hasConflict) choices.push(bin);
        }
        if (!choices.length) {
          valid = false;
          break;
        }
        const chosen = choices[Math.floor(rng() * choices.length)];
        bins[chosen].push(actor);
        assign[actorIdx.get(actor)][round] = chosen;
      }
    }

    if (!valid) continue;

    function hasSharedMovie(actorA, actorB) {
      const ai = actorIdx.get(actorA);
      const bi = actorIdx.get(actorB);
      for (let r = 0; r < FAKE_ROUNDS; r += 1) {
        if (assign[ai][r] === assign[bi][r]) return true;
      }
      return false;
    }

    function canMove(actor, round, newBin) {
      for (const other of FAKE_ACTORS) {
        if (other === actor) continue;
        const oi = actorIdx.get(other);
        if (assign[oi][round] === newBin && conflict(actor, other)) return false;
      }
      return true;
    }

    for (let repair = 0; repair < 2000; repair += 1) {
      const missing = required.filter(([a, b]) => !hasSharedMovie(a, b));
      if (!missing.length) {
        const movies = [];
        for (let r = 0; r < FAKE_ROUNDS; r += 1) {
          for (let b = 0; b < FAKE_MOVIES_PER_ROUND; b += 1) {
            const cast = FAKE_ACTORS.filter((actor) => assign[actorIdx.get(actor)][r] === b);
            const id = r * FAKE_MOVIES_PER_ROUND + b;
            movies.push({
              id,
              title: `Fake Movie ${String(id + 1).padStart(3, "0")}`,
              year: 1980 + (id % 44),
              cast
            });
          }
        }
        return movies;
      }

      const [a, b] = missing[Math.floor(rng() * missing.length)];
      const targetRound = Math.floor(rng() * FAKE_ROUNDS);
      const targetBin = assign[actorIdx.get(b)][targetRound];
      if (assign[actorIdx.get(a)][targetRound] === targetBin) continue;
      if (canMove(a, targetRound, targetBin)) {
        assign[actorIdx.get(a)][targetRound] = targetBin;
      }
    }
  }

  throw new Error("Could not generate fake movie schedule with constraints.");
}

function rowsFromMovies(movies) {
  const rows = [];
  for (const movie of movies) {
    for (const actor of movie.cast) {
      rows.push({ actor, movie: movie.title, movie_year: movie.year });
    }
  }
  return rows;
}

function generateFakeBoardState(rng = Math.random) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const actorsByCell = shuffle([...FAKE_ACTORS], rng);
    const path = generatePath(rng);
    const { required, forbidden } = buildForbiddenAndRequired(path, actorsByCell);

    try {
      const movies = scheduleMovies(required, forbidden, rng);
      const rows = rowsFromMovies(movies);
      const castByCredit = new Map();
      for (const row of rows) {
        const creditKey = movieCreditKey(row.movie, row.movie_year);
        if (!castByCredit.has(creditKey)) {
          castByCredit.set(creditKey, { title: row.movie, year: row.movie_year, cast: new Set() });
        }
        castByCredit.get(creditKey).cast.add(row.actor);
      }
      const dataset = buildDatasetFromCastMaps(castByCredit);

      const actorCounts = new Map(FAKE_ACTORS.map((a) => [a, 0]));
      for (const row of rows) {
        actorCounts.set(row.actor, actorCounts.get(row.actor) + 1);
      }
      const countOk = [...actorCounts.values()].every((n) => n === 10);
      if (!countOk) continue;

      const uniquePathCount = countWinningPaths(actorsByCell, dataset.sharedMoviesByPair);
      if (uniquePathCount !== 1) continue;

      return {
        actorsByCell,
        path,
        sharedMoviesByPair: dataset.sharedMoviesByPair
      };
    } catch (_err) {
      // Try again with a fresh board.
    }
  }

  throw new Error("Failed to generate fake board after multiple attempts.");
}

function pickCandidatePool(dataset, desiredSize, rng = Math.random) {
  const actorsWithDegree = dataset.actors.filter((actor) => (dataset.coStars.get(actor)?.size || 0) > 0);
  const mediumDegree = actorsWithDegree.filter((actor) => {
    const degree = dataset.coStars.get(actor).size;
    return degree >= 2 && degree <= 120;
  });

  const source = mediumDegree.length >= ACTOR_COUNT ? mediumDegree : actorsWithDegree;
  const size = Math.min(desiredSize, source.length);
  return sampleShuffled(source, size, rng);
}

function assignActorsToBoard(path, constraints, dataset, pool, rng = Math.random) {
  const assigned = Array(GRID_SIZE * GRID_SIZE).fill(null);
  const used = new Set();
  const allCells = [];
  const seen = new Set();

  for (const cell of path) {
    allCells.push(cell);
    seen.add(cell);
  }

  const rest = [];
  for (let cell = 0; cell < GRID_SIZE * GRID_SIZE; cell += 1) {
    if (!seen.has(cell)) rest.push(cell);
  }
  rest.sort((a, b) => neighbors(b).length - neighbors(a).length);
  allCells.push(...rest);

  function hasCoStar(a, b) {
    return dataset.coStars.get(a)?.has(b) || false;
  }

  function fits(cell, actor) {
    if (used.has(actor)) return false;

    for (const n of neighbors(cell)) {
      const other = assigned[n];
      if (!other) continue;
      const k = edgeKey(cell, n);
      const connected = hasCoStar(actor, other);
      if (constraints.requiredEdges.has(k) && !connected) return false;
      if (constraints.forbiddenEdges.has(k) && connected) return false;
    }

    return true;
  }

  function domain(cell) {
    const list = [];
    for (const actor of pool) {
      if (fits(cell, actor)) list.push(actor);
    }
    return shuffle(list, rng);
  }

  function search(depth) {
    if (depth === allCells.length) return true;

    let bestCell = -1;
    let bestDomain = null;

    for (const cell of allCells) {
      if (assigned[cell]) continue;
      const d = domain(cell);
      if (d.length === 0) return false;
      if (!bestDomain || d.length < bestDomain.length) {
        bestCell = cell;
        bestDomain = d;
        if (d.length === 1) break;
      }
    }

    const choices = bestDomain.length > 14 ? bestDomain.slice(0, 14) : bestDomain;
    for (const actor of choices) {
      assigned[bestCell] = actor;
      used.add(actor);
      if (search(depth + 1)) return true;
      used.delete(actor);
      assigned[bestCell] = null;
    }

    return false;
  }

  return search(0) ? assigned : null;
}

function generateBoardFromDataset(dataset, rng = Math.random) {
  if (!dataset || dataset.actors.length < ACTOR_COUNT) {
    throw new Error(`Dataset needs at least ${ACTOR_COUNT} unique actors.`);
  }

  for (let attempt = 0; attempt < SOLVER_ATTEMPTS; attempt += 1) {
    const path = generatePath(rng);
    const constraints = buildCellEdgeConstraints(path);
    const poolSize = 180 + (attempt % 4) * 20;
    const pool = pickCandidatePool(dataset, poolSize, rng);
    if (pool.length < ACTOR_COUNT) continue;

    const actorsByCell = assignActorsToBoard(path, constraints, dataset, pool, rng);
    if (!actorsByCell) continue;

    const uniquePathCount = countWinningPaths(actorsByCell, dataset.sharedMoviesByPair);
    if (uniquePathCount !== 1) continue;

    return {
      actorsByCell,
      path,
      sharedMoviesByPair: dataset.sharedMoviesByPair
    };
  }

  throw new Error("Could not generate a valid board from this dataset. Try refresh or New Board.");
}

function syncTraceLayerSize() {
  const rect = boardStageEl.getBoundingClientRect();
  traceLayerEl.setAttribute("viewBox", `0 0 ${rect.width} ${rect.height}`);
}

function getCellCenter(index) {
  const cell = gridEl.querySelector(`[data-index="${index}"]`);
  if (!cell) return null;

  const photo = cell.querySelector(".actor-photo");
  const targetEl = photo && !photo.classList.contains("hidden") ? photo : cell;
  const cellRect = targetEl.getBoundingClientRect();
  const stageRect = boardStageEl.getBoundingClientRect();
  return {
    x: cellRect.left - stageRect.left + cellRect.width / 2,
    y: cellRect.top - stageRect.top + cellRect.height / 2
  };
}

function getNearestAdjacentCellFromPoint(clientX, clientY, fromIndex) {
  const stageRect = boardStageEl.getBoundingClientRect();
  const localX = clientX - stageRect.left;
  const localY = clientY - stageRect.top;
  const fromCenter = getCellCenter(fromIndex);
  if (!fromCenter) return null;

  const fromCellEl = gridEl.querySelector(`[data-index="${fromIndex}"]`);
  const baseSize = fromCellEl ? fromCellEl.getBoundingClientRect().width : 80;
  const tolerance = baseSize * 0.7;

  let best = null;
  for (const n of neighbors(fromIndex)) {
    const center = getCellCenter(n);
    if (!center) continue;
    const dx = center.x - localX;
    const dy = center.y - localY;
    const dist = Math.hypot(dx, dy);
    if (dist > tolerance) continue;
    if (!best || dist < best.dist) {
      best = { index: n, dist };
    }
  }

  return best ? best.index : null;
}

function drawLine(x1, y1, x2, y2, color, width, opacity = 1, dashed = false) {
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  line.setAttribute("stroke", color);
  line.setAttribute("stroke-width", String(width));
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("opacity", String(opacity));
  if (dashed) line.setAttribute("stroke-dasharray", "10 8");
  return line;
}

function formatSharedMovies(shared) {
  return shared
    .map((m) => (Number.isFinite(m.year) ? `${m.title} (${m.year})` : `${m.title} (year unknown)`))
    .join("\n");
}

function removePopupById(id) {
  state.popups = state.popups.filter((popup) => popup.id !== id);
  renderPopupLayer();
}

function addPopup(from, to, text, type) {
  if (type === "good" || type === "hint") {
    const existing = state.popups.find(
      (popup) => popup.type === type && edgeKey(popup.from, popup.to) === edgeKey(from, to)
    );
    if (existing) {
      if (type === "good") {
        removePopupById(existing.id);
      } else {
        existing.text = text;
        renderPopupLayer();
        return;
      }
    }
  }

  const popup = {
    id: state.nextPopupId,
    from,
    to,
    text,
    type
  };
  state.nextPopupId += 1;
  state.popups.push(popup);
  renderPopupLayer();

  if (type === "bad") {
    window.setTimeout(() => removePopupById(popup.id), 2000);
  }
  if (type === "good") {
    window.setTimeout(() => removePopupById(popup.id), 6000);
  }
}

function replayEdgeMovies(from, to) {
  const fromActor = state.actorsByCell[from];
  const toActor = state.actorsByCell[to];
  const shared = state.sharedMoviesByPair.get(pairKey(fromActor, toActor));
  if (!shared || shared.length === 0) return;
  addPopup(from, to, formatSharedMovies(shared), "good");
}

function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1);
  const t = ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  const cx = x1 + tc * dx;
  const cy = y1 + tc * dy;
  return Math.hypot(px - cx, py - cy);
}

function onBoardClickReplay(e) {
  const stageRect = boardStageEl.getBoundingClientRect();
  const px = e.clientX - stageRect.left;
  const py = e.clientY - stageRect.top;
  let best = null;

  for (const trace of state.traces) {
    if (!(trace.valid && trace.kind === "move")) continue;
    const from = getCellCenter(trace.from);
    const to = getCellCenter(trace.to);
    if (!from || !to) continue;
    const dist = pointToSegmentDistance(px, py, from.x, from.y, to.x, to.y);
    if (dist > 10) continue;
    if (!best || dist < best.dist) best = { trace, dist };
  }

  if (best) {
    replayEdgeMovies(best.trace.from, best.trace.to);
  }
}

function renderTraceLayer() {
  traceLayerEl.innerHTML = "";
  syncTraceLayerSize();

  for (const trace of state.traces) {
    const from = getCellCenter(trace.from);
    const to = getCellCenter(trace.to);
    if (!from || !to) continue;

    if (!trace.valid && trace.kind !== "hint") {
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const size = 6.5;
      const x1 = drawLine(mx - size, my - size, mx + size, my + size, "#b42318", 6, 0.9, false);
      const x2 = drawLine(mx - size, my + size, mx + size, my - size, "#b42318", 6, 0.9, false);
      traceLayerEl.appendChild(x1);
      traceLayerEl.appendChild(x2);
      continue;
    }

    const color = trace.kind === "hint" ? "#2d7dc0" : "#1f7a4a";
    const line = drawLine(from.x, from.y, to.x, to.y, color, 12, 0.88, false);
    traceLayerEl.appendChild(line);
  }

  if (state.dragPreview) {
    const from = getCellCenter(state.dragPreview.from);
    if (from) {
      let target = null;
      if (Number.isInteger(state.dragPreview.to)) {
        target = getCellCenter(state.dragPreview.to);
      }
      if (!target) {
        target = { x: state.dragPreview.x, y: state.dragPreview.y };
      }
      if (target) {
        const preview = drawLine(from.x, from.y, target.x, target.y, "#19647e", 8, 0.72, true);
        traceLayerEl.appendChild(preview);
      }
    }
  }
}

function renderPopupLayer() {
  popupLayerEl.innerHTML = "";

  for (const popup of state.popups) {
    const from = getCellCenter(popup.from);
    const to = getCellCenter(popup.to);
    if (!from || !to) continue;

    const el = document.createElement("div");
    el.className = `move-popup ${popup.type}`;
    if (popup.type === "bad") {
      el.classList.add("temporary");
    }
    if (popup.type === "good") {
      el.classList.add("temporary-long");
    }

    el.textContent = popup.text;
    el.style.left = `${(from.x + to.x) / 2}px`;
    el.style.top = `${(from.y + to.y) / 2}px`;
    popupLayerEl.appendChild(el);
  }
}

function renderMissBar() {
  missBarEl.innerHTML = "";
  const spent = MAX_MISSES - state.missesLeft;
  for (let i = 0; i < MAX_MISSES; i += 1) {
    const box = document.createElement("div");
    box.className = "miss-box";
    if (i < spent) box.classList.add("spent");
    missBarEl.appendChild(box);
  }
}

function renderGrid() {
  gridEl.innerHTML = "";
  for (let i = 0; i < state.actorsByCell.length; i += 1) {
    const actor = state.actorsByCell[i];
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.index = String(i);
    const photo = document.createElement("img");
    photo.className = "actor-photo";
    photo.alt = actor;
    photo.draggable = false;
    photo.src = `./actor_photos/${encodeURIComponent(actorPhotoStem(actor))}.jpg`;
    photo.addEventListener("error", () => {
      photo.classList.add("hidden");
    });

    const label = document.createElement("span");
    label.className = "actor-name";
    label.textContent = actor;

    cell.appendChild(photo);
    cell.appendChild(label);

    if (i === state.currentIndex) {
      cell.classList.add("active");
      cell.draggable = !state.finished;
    }
    if (i === state.targetIndex) cell.classList.add("target");

    cell.addEventListener("dragstart", onDragStart);
    cell.addEventListener("dragend", onDragEnd);
    cell.addEventListener("dragover", onDragOver);
    cell.addEventListener("drop", onDrop);
    cell.addEventListener("dragenter", onDragEnter);
    cell.addEventListener("dragleave", onDragLeave);
    cell.addEventListener("click", onCellClick);
    cell.addEventListener("pointerdown", onCellPointerDown);
    gridEl.appendChild(cell);
  }

  renderTraceLayer();
  renderPopupLayer();
}

function updateStatusLine() {
  const actor = state.actorsByCell[state.currentIndex];
  setStatus(`Current: ${actor} | Misses left: ${state.missesLeft}`);
  renderMissBar();
}

function addTrace(from, to, valid, kind = "move") {
  state.traces.push({ from, to, valid, kind });
}

function clearDragPreview() {
  state.dragPreview = null;
  renderTraceLayer();
}

function updateDragPreviewFromPoint(clientX, clientY, fromIndex = state.currentIndex) {
  const stageRect = boardStageEl.getBoundingClientRect();
  state.dragPreview.x = clientX - stageRect.left;
  state.dragPreview.y = clientY - stageRect.top;

  const targetEl = document.elementFromPoint(clientX, clientY);
  const cellEl = targetEl ? targetEl.closest(".cell") : null;
  if (!cellEl || !gridEl.contains(cellEl)) {
    state.dragPreview.to = getNearestAdjacentCellFromPoint(clientX, clientY, fromIndex);
  } else {
    const idx = Number(cellEl.dataset.index);
    if (isAdjacent(fromIndex, idx)) {
      state.dragPreview.to = idx;
    } else {
      state.dragPreview.to = getNearestAdjacentCellFromPoint(clientX, clientY, fromIndex);
    }
  }

  renderTraceLayer();
}

function tryMove(toIndex) {
  if (state.finished) return;
  if (!isAdjacent(state.currentIndex, toIndex)) return;

  const fromIndex = state.currentIndex;
  const fromActor = state.actorsByCell[fromIndex];
  const toActor = state.actorsByCell[toIndex];
  const shared = state.sharedMoviesByPair.get(pairKey(fromActor, toActor));

  if (!shared || shared.length === 0) {
    addTrace(fromIndex, toIndex, false);
    addPopup(fromIndex, toIndex, "No shared movie", "bad");
    state.missesLeft -= 1;
    state.failedMoves += 1;

    if (state.missesLeft <= 0) {
      state.finished = true;
      state.won = false;
      setStatus("Game over: no misses left.", "bad");
      showEndgameModal(false);
      revealSolutionPath();
    } else {
      updateStatusLine();
    }

    renderGrid();
    return;
  }

  addTrace(fromIndex, toIndex, true);
  addPopup(fromIndex, toIndex, formatSharedMovies(shared), "good");
  state.currentIndex = toIndex;
  state.successMoves += 1;

  if (state.currentIndex === state.targetIndex) {
    state.finished = true;
    state.won = true;
    setStatus(`You won with ${state.missesLeft} miss(es) left.`, "good");
    showEndgameModal(true);
  } else {
    updateStatusLine();
  }

  renderGrid();
}

function findValidPath(fromIndex, toIndex) {
  const queue = [fromIndex];
  const prev = new Map([[fromIndex, null]]);

  while (queue.length) {
    const cur = queue.shift();
    if (cur === toIndex) break;

    for (const n of neighbors(cur)) {
      if (prev.has(n)) continue;
      const a = state.actorsByCell[cur];
      const b = state.actorsByCell[n];
      if (!state.sharedMoviesByPair.has(pairKey(a, b))) continue;
      prev.set(n, cur);
      queue.push(n);
    }
  }

  if (!prev.has(toIndex)) return null;
  const path = [];
  let cur = toIndex;
  while (cur !== null) {
    path.push(cur);
    cur = prev.get(cur);
  }
  path.reverse();
  return path;
}

function revealSolutionPath() {
  let path = findValidPath(state.currentIndex, state.targetIndex);
  if (!path) {
    path = findValidPath(0, state.targetIndex);
    if (!path) return;
    setStatus("Game over. No route from current actor; showing solution from start.", "bad");
  }

  for (let i = 0; i < path.length - 1; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const fromActor = state.actorsByCell[from];
    const toActor = state.actorsByCell[to];
    const shared = state.sharedMoviesByPair.get(pairKey(fromActor, toActor)) || [];
    const text = formatSharedMovies(shared);
    addTrace(from, to, true, "hint");
    if (text) addPopup(from, to, text, "hint");
  }
}

function onKeyDown(e) {
  if (!(e.key in dirs) || state.finished) return;

  const [r, c] = rc(state.currentIndex);
  if (e.key === "ArrowUp" && r === 0) return;
  if (e.key === "ArrowDown" && r === GRID_SIZE - 1) return;
  if (e.key === "ArrowLeft" && c === 0) return;
  if (e.key === "ArrowRight" && c === GRID_SIZE - 1) return;

  e.preventDefault();
  tryMove(state.currentIndex + dirs[e.key]);
}

function onDragStart(e) {
  if (state.finished) return;
  const idx = Number(e.currentTarget.dataset.index);
  if (idx !== state.currentIndex) {
    e.preventDefault();
    return;
  }

  e.dataTransfer.setData("text/plain", String(idx));
  state.dragPreview = { from: idx, to: null, x: 0, y: 0 };
  renderTraceLayer();
}

function onDragEnd() {
  clearDragPreview();
}

function onDocumentDragOver(e) {
  if (!state.dragPreview) return;
  updateDragPreviewFromPoint(e.clientX, e.clientY, state.currentIndex);
}

function onDragOver(e) {
  const idx = Number(e.currentTarget.dataset.index);
  if (isAdjacent(state.currentIndex, idx) && !state.finished) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }
}

function onDrop(e) {
  if (state.finished) return;
  e.preventDefault();
  e.stopPropagation();
  const from = Number(e.dataTransfer.getData("text/plain"));
  const to = Number(e.currentTarget.dataset.index);
  clearDragPreview();
  if (from === state.currentIndex && isAdjacent(from, to)) {
    tryMove(to);
  }
}

function onBoardDragOver(e) {
  if (!state.dragPreview || state.finished) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
}

function onBoardDrop(e) {
  if (state.finished) return;
  e.preventDefault();
  const from = Number(e.dataTransfer.getData("text/plain"));
  const to = state.dragPreview ? state.dragPreview.to : null;
  clearDragPreview();
  if (from === state.currentIndex && Number.isInteger(to) && isAdjacent(from, to)) {
    tryMove(to);
  }
}

function onDragEnter(e) {
  const idx = Number(e.currentTarget.dataset.index);
  if (isAdjacent(state.currentIndex, idx) && !state.finished) {
    e.currentTarget.classList.add("drag-ready");
  }
}

function onDragLeave(e) {
  e.currentTarget.classList.remove("drag-ready");
}

function onCellClick(e) {
  const idx = Number(e.currentTarget.dataset.index);
  if (state.finished || idx === state.currentIndex || !isAdjacent(state.currentIndex, idx)) return;
  e.stopPropagation();
  tryMove(idx);
}

function isTouchPointer(e) {
  return e.pointerType === "touch" || e.pointerType === "pen";
}

function onCellPointerDown(e) {
  if (!isTouchPointer(e) || state.finished) return;
  const idx = Number(e.currentTarget.dataset.index);
  if (idx !== state.currentIndex) return;

  e.preventDefault();
  state.dragPreview = { from: idx, to: null, x: 0, y: 0, pointerId: e.pointerId };
  updateDragPreviewFromPoint(e.clientX, e.clientY, idx);
}

function onBoardPointerMove(e) {
  if (!state.dragPreview || !isTouchPointer(e) || state.dragPreview.pointerId !== e.pointerId) return;
  e.preventDefault();
  updateDragPreviewFromPoint(e.clientX, e.clientY, state.dragPreview.from);
}

function finishPointerDrag(pointerId, commitMove) {
  if (!state.dragPreview || state.dragPreview.pointerId !== pointerId) return;
  const from = state.dragPreview.from;
  const to = state.dragPreview.to;
  clearDragPreview();
  if (commitMove && from === state.currentIndex && Number.isInteger(to) && isAdjacent(from, to)) {
    tryMove(to);
  }
}

function onBoardPointerUp(e) {
  if (!isTouchPointer(e)) return;
  finishPointerDrag(e.pointerId, true);
}

function onBoardPointerCancel(e) {
  if (!isTouchPointer(e)) return;
  finishPointerDrag(e.pointerId, false);
}

function createShareText() {
  const guessBoxes = Array.from({ length: MAX_MISSES }, (_, i) => (i < state.failedMoves ? "🟥" : "🟩")).join("");
  const titleLink = `[CelebriGrid #${state.dayNumber}](${SHARE_GAME_URL})`;
  return [titleLink, guessBoxes].join("\n");
}

async function onShare() {
  const text = createShareText();
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      setStatus("Share text copied to clipboard.", "good");
      return;
    }

    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) {
      setStatus("Share text copied to clipboard.", "good");
    } else {
      throw new Error("execCommand copy failed");
    }
  } catch {
    setStatus("Clipboard unavailable. Share text is in console.", "bad");
    console.log(text);
  }
}

function resetGame() {
  try {
    const dayInfo = loadDailyBoard();
    const generated = {
      actorsByCell: dayInfo.actorsByCell,
      path: dayInfo.path,
      sharedMoviesByPair: dayInfo.sharedMoviesByPair
    };

    state.boardId = dayInfo.dayDateKey;
    state.dayNumber = dayInfo.dayNumber;
    state.dayDateKey = dayInfo.dayDateKey;
    state.actorsByCell = generated.actorsByCell;
    state.sharedMoviesByPair = generated.sharedMoviesByPair;
    state.currentIndex = 0;
    state.targetIndex = GRID_SIZE * GRID_SIZE - 1;
    state.missesLeft = MAX_MISSES;
    state.successMoves = 0;
    state.failedMoves = 0;
    state.finished = false;
    state.won = false;
    state.pathCells = generated.path;
    state.traces = [];
    state.dragPreview = null;
    state.popups = [];
    state.nextPopupId = 1;

    hideEndgameModal();
    shareDockEl.hidden = true;
    shareDockEl.setAttribute("aria-hidden", "true");
    shareBtnDock.hidden = true;
    shareBtnDock.disabled = true;
    subtitleEl.textContent = `Daily board #${state.dayNumber}`;
    renderGrid();
    updateStatusLine();
    renderMissBar();
  } catch (err) {
    setStatus("Board generation failed. See log.", "bad");
    console.error(err);
  }
}

async function loadDefaultDataset() {
  try {
    const response = await fetch("./movies.csv", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const text = await response.text();
    const dataset = buildDatasetFromCsvText(text);
    if (dataset.actors.length < ACTOR_COUNT) {
      throw new Error(`movies.csv has only ${dataset.actors.length} unique actors.`);
    }

    runtime.sourceType = "csv";
    runtime.sourceLabel = "movies.csv";
    runtime.csvDataset = dataset;
  } catch (_err) {
    runtime.sourceType = "fake";
    runtime.sourceLabel = "built-in fake dataset";
    runtime.csvDataset = null;
  }
}

document.addEventListener("keydown", onKeyDown);
document.addEventListener("dragover", onDocumentDragOver);
window.addEventListener("resize", () => {
  renderTraceLayer();
  renderPopupLayer();
});
shareBtnModal.addEventListener("click", onShare);
shareBtnDock.addEventListener("click", onShare);
closeEndgameBtn.addEventListener("click", closeEndgameModalToDock);
boardStageEl.addEventListener("dragover", onBoardDragOver);
boardStageEl.addEventListener("drop", onBoardDrop);
boardStageEl.addEventListener("pointermove", onBoardPointerMove);
boardStageEl.addEventListener("pointerup", onBoardPointerUp);
boardStageEl.addEventListener("pointercancel", onBoardPointerCancel);
boardStageEl.addEventListener("click", onBoardClickReplay);

(async function init() {
  hideEndgameModal();
  shareDockEl.hidden = true;
  shareDockEl.setAttribute("aria-hidden", "true");
  shareBtnDock.hidden = true;
  shareBtnDock.disabled = true;
  setStatus("Loading dataset...");
  await loadDefaultDataset();
  resetGame();
})();
