// SRS 6.4:  T(L) = base * L * (L - 1) / 2   (base = 100 by default)
//   L1 = 0, L2 = 100, L3 = 300, L4 = 600, L5 = 1000 ...

function xpForLevel(level, base = 100) {
  return (base * level * (level - 1)) / 2;
}

function levelForXp(xp, base = 100) {
  const safe = Math.max(0, Number(xp) || 0);
  // Solve base*L*(L-1)/2 <= xp analytically, then correct for float error.
  let L = Math.floor((1 + Math.sqrt(1 + (8 * safe) / base)) / 2);
  while (xpForLevel(L + 1, base) <= safe) L++;
  while (L > 1 && xpForLevel(L, base) > safe) L--;
  return Math.max(1, L);
}

function levelInfo(xp, base = 100) {
  const level = levelForXp(xp, base);
  const floor = xpForLevel(level, base);
  const ceil = xpForLevel(level + 1, base);
  return {
    level,
    xp: Math.max(0, xp),
    levelStartXp: floor,
    nextLevelXp: ceil,
    nextLevel: level + 1,
    xpIntoLevel: xp - floor,
    xpToNext: ceil - xp,
    progressPct: Math.round(((xp - floor) / (ceil - floor)) * 100)
  };
}

module.exports = { xpForLevel, levelForXp, levelInfo };
