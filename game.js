/* =========================
         Utilities
      ========================= */
const d2 = () => Math.floor(Math.random() * 2) + 1;
const d5 = () => Math.floor(Math.random() * 5) + 1;
const d6 = () => Math.floor(Math.random() * 6) + 1;
const d10 = () => Math.floor(Math.random() * 10) + 1;

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const pct = (p) => Math.random() * 100 < p;
const nowTime = () => new Date().toLocaleTimeString();

function hpBarHTML(hp, maxHp) {
  const ratio = maxHp > 0 ? hp / maxHp : 0;
  const percent = Math.max(0, Math.min(100, Math.floor(ratio * 100)));

  let cls = "high";
  if (percent < 30) cls = "low";
  else if (percent < 60) cls = "mid";

  return `
          <div class="hpbar">
            <div class="hpfill ${cls}" style="width:${percent}%"></div>
          </div>
          <div class="mono" style="font-size:11px; color:#aaa">
            ${hp} / ${maxHp} (${percent}%)
          </div>
        `;
}

const ROLE_LABEL = {
  TANK: "탱커",
  DPS: "딜러",
  SUPPORT: "서포터",
};

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function fmtHp(hp, max) {
  const p =
    max > 0
      ? Math.max(0, Math.min(100, Math.round((hp / max) * 100)))
      : 0;
  return `${hp}/${max} (${p}%)`;
}

function makeId(prefix) {
  return prefix + "_" + Math.random().toString(36).slice(2, 9);
}

/* =========================
         Game Data
      ========================= */
const game = {
  round: 1,
  phase: "HINT", // HINT | PLAYER | RESOLVE
  players: [],
  monsters: [],
  // per round
  monsterIntents: null, // {type, text, targets?}
  actions: new Map(), // playerId -> action object
  logLines: [],
};

// 되돌리기를 위한 스냅샷 저장
let gameSnapshot = null;

function deepClone(obj) {
  if (obj === null || typeof obj !== "object") return obj;
  if (obj instanceof Map) {
    const newMap = new Map();
    obj.forEach((v, k) => newMap.set(k, deepClone(v)));
    return newMap;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item));
  }
  const cloned = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      cloned[key] = deepClone(obj[key]);
    }
  }
  return cloned;
}

function saveSnapshot() {
  gameSnapshot = {
    round: game.round,
    phase: game.phase,
    players: deepClone(game.players),
    monsters: deepClone(game.monsters),
    monsterIntents: deepClone(game.monsterIntents),
    actions: deepClone(game.actions),
    logLines: [...game.logLines],
  };
}

function restoreSnapshot() {
  if (!gameSnapshot) {
    log("⚠️ 되돌릴 수 있는 상태가 없습니다.");
    return false;
  }
  game.round = gameSnapshot.round;
  game.phase = gameSnapshot.phase;
  game.players = deepClone(gameSnapshot.players);
  game.monsters = deepClone(gameSnapshot.monsters);
  game.monsterIntents = deepClone(gameSnapshot.monsterIntents);
  game.actions = deepClone(gameSnapshot.actions);
  game.logLines = [...gameSnapshot.logLines];
  return true;
}

function undoRound() {
  if (!gameSnapshot) {
    log(
      "⚠️ 되돌릴 수 있는 상태가 없습니다. (라운드 합산 전에는 되돌리기 불가)"
    );
    return;
  }
  if (restoreSnapshot()) {
    log("↩ 합산 전 상태로 되돌렸습니다. 행동을 다시 선택하세요.");
    renderPlayerActionCards();
    renderStates();
    // 몬스터 행동 암시 다시 표시
    if (game.monsterIntents) {
      const hintText = game.monsterIntents
        .map((x) => "- " + x.text)
        .join("\n");
      document.getElementById("hintBox").textContent = hintText;
    }
  }
}

/* =========================
         Rules & Skills
      ========================= */
const ROLE = { TANK: "TANK", DPS: "DPS", SUPPORT: "SUPPORT" };

const SKILLS = {
  TANK: {
    active: [
      {
        key: "GUARD",
        name: "호위",
        desc: "1턴간 지정 2인에게 자신의 최종 방어 값×1d6×0.8 보호막",
        target: "ALLY2",
      },
      {
        key: "PROTECT",
        name: "수호",
        desc: "1턴간 지정 1인의 피해를 대신 받음. 방어 보너스: def×1.3×1d6",
        target: "ALLY1",
      },
      {
        key: "ENDURE",
        name: "인내",
        desc: "3턴간 받은 피해 누적 → 종료 시 누적*0.5 반사 + 어그로 50% 증가",
        target: "NONE",
      },
      {
        key: "FIGHTING_SPIRIT",
        name: "투혼",
        desc: "지정 적에게 고정 50 (방어 무시), 2턴간 자신 DEF -3",
        target: "ENEMY1",
      },
    ],
    ult: [
      {
        key: "UNYIELDING",
        name: "불굴",
        desc: "1턴간 모든 아군 피해/디버프를 본인이 받음. 체력은 1 미만으로 내려가지 않음",
        target: "NONE",
      },
      {
        key: "DEVOTION",
        name: "헌신",
        desc: "현재 체력 100% 소모 후 최종 방어값*2 만큼 적 전체 공격",
        target: "ENEMY_ALL",
      },
    ],
  },
  DPS: {
    active: [
      {
        key: "MADNESS",
        name: "광기",
        desc: "다음 1턴간 공격 스탯 +3 (중첩 가능)",
        target: "NONE",
      },
      {
        key: "OBSESSION",
        name: "집념",
        desc: "3턴간 지정 적 1에게 기본 공격값×1d6×0.8 지속 피해(중첩 가능)",
        target: "ENEMY1",
      },
      {
        key: "BLOODFIGHT",
        name: "혈투",
        desc: "현재 체력 30% 소모 후 지정 적 1에게 최종 공격값*2",
        target: "ENEMY1",
      },
      {
        key: "MASSACRE",
        name: "참살",
        desc: "적 전체에게 최종 공격값*1.5",
        target: "ENEMY_ALL",
      },
    ],
    ult: [
      {
        key: "MERCY",
        name: "자비",
        desc: "공격 다이스 2회 합산 후 최종 공격값*2.5",
        target: "ENEMY1",
      },
      {
        key: "CHARGE",
        name: "돌격",
        desc: "적 방어값 무시, 공격 다이스 2회 합산 후 ×2 공격",
        target: "ENEMY1",
      },
    ],
  },
  SUPPORT: {
    active: [
      {
        key: "REVIVE",
        name: "회생",
        desc: "지정 1인 체력을 최종 민첩값의 1.5배 만큼 회복",
        target: "ALLY1",
      },
      {
        key: "BLESS",
        name: "가호",
        desc: "지정 2인 체력을 최종 민첩값만큼 회복",
        target: "ALLY2",
      },
      {
        key: "ENCOURAGE",
        name: "격려",
        desc: "다음 1턴간 지정 1인의 지정 스탯 +3 (중첩 가능)",
        target: "ALLY1_STAT",
      },
      {
        key: "PURIFY",
        name: "정화",
        desc: "지정 2인의 디버프 해제",
        target: "ALLY2",
      },
      {
        key: "PENANCE",
        name: "참회",
        desc: "지정 적 1인의 최종 공격값을 (본인 최종 민첩값*0.5)만큼 감소(중첩 불가, 1턴)",
        target: "ENEMY1",
      },
    ],
    ult: [
      {
        key: "REINCARNATION",
        name: "윤회",
        desc: "지정 아군 1인의 궁극기 횟수 초기화",
        target: "ALLY1",
      },
      {
        key: "REST",
        name: "안식",
        desc: "전체 아군 100% 회복 + 다운 대기 제거 + 전체 액티브 재사용 초기화",
        target: "ALLY_ALL",
      },
    ],
  },
};

/* =========================
         Entity model
      ========================= */
function deletePlayer(playerId) {
  const idx = game.players.findIndex((p) => p.id === playerId);
  if (idx !== -1) {
    const name = game.players[idx].name;
    game.players.splice(idx, 1);
    game.actions.delete(playerId);
    log(`🗑️ ${name} 삭제됨`);
    renderPlayerActionCards();
    renderStates();
  }
}

function deleteMonster(monsterId) {
  const idx = game.monsters.findIndex((m) => m.id === monsterId);
  if (idx !== -1) {
    const name = game.monsters[idx].name;
    game.monsters.splice(idx, 1);
    log(`🗑️ ${name} 삭제됨`);
    renderStates();
  }
}

function makePlayer({ name, role, vit, atk, def, agi, actives, ult }) {
  const maxHp = 150 + vit * 10;
  return {
    id: makeId("P"),
    type: "PLAYER",
    name,
    role,
    base: { vit, atk, def, agi },
    // dynamic buffs (turn-based)
    temp: {
      atkPlus: 0, // from MADNESS (applies next turn) and ENCOURAGE etc.
      defPlus: 0,
      agiPlus: 0,
      vitPlus: 0,
    },
    hp: maxHp,
    maxHp,
    down: false,
    downCounter: 0, // when >0 cannot act; when reaches 0 -> revive 30%
    ultUsed: false,
    actives,
    ult,
    lastActiveKey: null,
    // states
    shields: [], // [{value, expiresRound}]
    redirect: null, // {tankId, reduction} applied to this player
    tankingAll: false, // UNYIELDING flag on tank
    minHpFloor: false, // if true: hp cannot drop below 1 this round
    debuffs: [], // [{type, value, turns, sourceId}]
    dots: [], // [{type, value, turns, sourceId}] ticking each round start
    endure: null, // {accum, turnsLeft}
    fightingSpirit: null, // {targetId, turnsLeft}
    pendingAtkPlusNext: 0, // for MADNESS stacking
    pendingEncourage: [], // [{stat, value}] for next turn ENCOURAGE
    hasAggro: false, // 인내 스킬 사용 시 어그로 증가
  };
}

function makeMonster({ name, vit, atk, def, agi, hpBase, patterns }) {
  const maxHp = hpBase; // monster HP is manual base as requested
  return {
    id: makeId("M"),
    type: "MONSTER",
    name,
    base: { vit, atk, def, agi },
    temp: { atkPlus: 0, defPlus: 0, agiPlus: 0, vitPlus: 0 },
    hp: maxHp,
    maxHp,
    alive: true,
    buffs: [],
    debuffs: [],
    dots: [],
    shields: [],
    // 공격 패턴 비율 (기본값: 각 25%)
    patterns: patterns || { single: 25, aoe: 25, bleed: 25, buff: 25 },
  };
}

/* =========================
         Combat Calculations
      ========================= */
function effectiveStat(entity, key) {
  const base = entity.base[key] || 0;

  // 플레이어 temp 스탯 (격려 등)
  const plusKey = key + "Plus";
  const plus = entity.temp?.[plusKey] || 0;

  // 몬스터 자가버프 합산
  let buff = 0;
  if (entity.buffs) {
    for (const b of entity.buffs) {
      if (b.stat === key) {
        buff += b.value;
      }
    }
  }

  // special: fighting spirit reduces DEF base stat by 5 while active (tank only)
  let special = 0;
  if (
    entity.type === "PLAYER" &&
    entity.fightingSpirit &&
    key === "def"
  ) {
    special -= 3;
  }

  return clamp(base + plus + buff + special, 0, 99);
}

// "final stat value" as used in skills: stat * 1d6
function finalStat(entity, key) {
  const s = effectiveStat(entity, key);
  return s * d6();
}

function critChance(entity) {
  // only base agility stat (initial), not buffs: per spec
  const p = clamp(entity.base.agi, 0, 100);
  return p;
}

function baseAttackDamage(attacker) {
  const atk = effectiveStat(attacker, "atk");
  const roll = d6();
  return { damage: atk * roll, atk, roll };
}

function baseDefenseMitigation(defender, defMult = 1.0) {
  const def = effectiveStat(defender, "def");
  // 플레이어는 1d2, 몬스터는 1d5
  const roll = defender.type === "MONSTER" ? d5() : d2();
  const diceType = defender.type === "MONSTER" ? "1d5" : "1d2";
  return {
    mitigation: Math.floor(def * defMult * roll),
    def,
    roll,
    defMult,
    diceType,
  };
}

function consumeShield(defender, dmg) {
  if (dmg <= 0) return { dmg: 0, absorbed: 0 };
  let remaining = dmg;
  let absorbed = 0;
  // shields consume oldest first
  defender.shields.sort((a, b) => a.expiresRound - b.expiresRound);
  for (const sh of defender.shields) {
    if (remaining <= 0) break;
    const take = Math.min(sh.value, remaining);
    sh.value -= take;
    remaining -= take;
    absorbed += take;
  }
  defender.shields = defender.shields.filter((s) => s.value > 0);
  return { dmg: remaining, absorbed };
}

function applyDamage(
  defender,
  rawDmg,
  {
    ignoreDefense = false,
    sourceText = "",
    allowFloor = false,
    defMult = 1.0,
    defBonus = 0,
  } = {}
) {
  if (defender.type === "MONSTER" && !defender.alive)
    return { dealt: 0, mitigated: 0, absorbed: 0, defFormula: "" };

  // downed still can take damage (keeps at 0), but we'll allow
  let dmg = Math.max(0, Math.floor(rawDmg));

  // shields first
  const shieldRes = consumeShield(defender, dmg);
  dmg = shieldRes.dmg;

  let mitigated = 0;
  let defFormula = "";

  // 수호 방어 보너스는 ignoreDefense와 별개로 항상 적용
  if (defBonus > 0) {
    mitigated += Math.min(defBonus, dmg);
    dmg = Math.max(0, dmg - defBonus);
    defFormula = `수호 방어 보너스 ${defBonus}`;
  }

  if (!ignoreDefense) {
    const mitResult = baseDefenseMitigation(defender, defMult);
    let mit = mitResult.mitigation;
    
    if (defMult !== 1.0) {
      defFormula += (defFormula ? " + " : "") + `방어 ${mitResult.def}×${mitResult.roll}(${mitResult.diceType || "1d2"})×${defMult}=${mit}`;
    } else {
      defFormula += (defFormula ? " + " : "") + `방어 ${mitResult.def}×${mitResult.roll}(${mitResult.diceType || "1d2"})=${mit}`;
    }
    
    mitigated += Math.min(mit, dmg);
    dmg = Math.max(0, dmg - mit);
  }

  // defend action adds extra mitigation stored on defender this round
  if (defender._defendBonus && !ignoreDefense) {
    const extra = defender._defendBonus;
    mitigated += Math.min(extra, dmg);
    dmg = Math.max(0, dmg - extra);
    defFormula += defFormula
      ? ` +방어행동 ${extra}`
      : `방어행동 ${extra}`;
  }

  const beforeHp = defender.hp;
  defender.hp = Math.max(0, defender.hp - dmg);

  // UNYIELDING floor (hp cannot go below 1)
  if (defender.type === "PLAYER") {
    if (defender.minHpFloor || allowFloor) {
      if (defender.hp < 1) defender.hp = 1;
    }
  }

  // monster alive flag
  if (defender.type === "MONSTER") {
    if (defender.hp <= 0) {
      defender.alive = false;
      defender.hp = 0;
    }
  }

  const dealt = beforeHp - defender.hp;

  return {
    dealt,
    mitigated,
    absorbed: shieldRes.absorbed,
    defFormula,
  };
}

function heal(target, amount) {
  const v = Math.max(0, Math.floor(amount));
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + v);
  return target.hp - before;
}

function setDownIfNeeded(player) {
  if (player.type !== "PLAYER") return;
  if (player.hp <= 0 && !player.down) {
    player.down = true;
    player.downCounter = 2; // 1턴 대기 후 2턴에서(=2라운드 후) 행동 가능으로 구현
    player.hp = 0;
  }
}

function reviveIfReady(player) {
  if (player.type !== "PLAYER") return;
  if (player.down) {
    player.downCounter = Math.max(0, player.downCounter - 1);
    if (player.downCounter === 0) {
      player.down = false;
      player.hp = Math.max(1, Math.floor(player.maxHp * 0.3));

      // 부활 시 디버프/DOT/스킬 상태 초기화
      player.debuffs = [];
      player.dots = [];
      player.temp = { atkPlus: 0, defPlus: 0, agiPlus: 0, vitPlus: 0 };
      player.lastActiveKey = null;
      player.endure = null;
      player.fightingSpirit = null;
      player.pendingAtkPlusNext = 0;
      player.pendingEncourage = [];
      player.tankingAll = false;
      player.minHpFloor = false;
      player.redirect = null;
      player.hasAggro = false;
      player._defendBonus = 0;

      log(
        `↺ ${player.name} 소생: HP ${player.hp}/${player.maxHp} (30%) - 디버프/스킬 초기화`
      );
    }
  } else {
    // apply "madness" pending atk+ for this round start
    if (player.pendingAtkPlusNext > 0) {
      player.temp.atkPlus += player.pendingAtkPlusNext;
      // 1턴 후 제거를 위한 디버프 마커 추가 (격려와 동일한 방식)
      addDebuff(player, {
        type: "MADNESS_ATK",
        value: player.pendingAtkPlusNext,
        turns: 1,
        sourceId: player.id,
      });
      log(
        `▲ ${player.name} 공격 +${player.pendingAtkPlusNext} (광기 적용, 이번 턴만)`
      );
      player.pendingAtkPlusNext = 0;
    }
    // apply pending ENCOURAGE buffs for this round
    if (player.pendingEncourage && player.pendingEncourage.length > 0) {
      for (const enc of player.pendingEncourage) {
        const plusKey = enc.stat + "Plus";
        player.temp[plusKey] += enc.value;
        // 1턴 후 제거를 위한 디버프 마커 추가
        addDebuff(player, {
          type: "ENCOURAGE_" + enc.stat.toUpperCase(),
          value: enc.value,
          turns: 1,
          sourceId: enc.sourceId,
        });
        log(
          `📣 ${player.name} 격려 발동: ${enc.stat.toUpperCase()} +${
            enc.value
          } (이번 턴)`
        );
      }
      player.pendingEncourage = [];
    }
  }
}

/* =========================
         DOT / Debuff
      ========================= */
function addDot(target, dot) {
  target.dots.push(dot);
}
function addDebuff(target, debuff) {
  // PENANCE not stackable
  if (debuff.type === "PENANCE") {
    if (target.debuffs.some((d) => d.type === "PENANCE")) return false;
  }
  target.debuffs.push(debuff);
  return true;
}
function clearDebuffs(target) {
  target.debuffs = [];
}
function tickDots() {
  // DOT 틱 - 불굴(tankingAll) 또는 수호(redirect) 상태면 탱커가 대신 받음
  const tankAll = game.players.find((p) => p.tankingAll && !p.down);

  // 먼저 각 플레이어의 DOT를 수집하고, 누가 대신 받을지 결정
  const dotDamages = []; // { target, bleed, other, originalPlayer }

  for (const p of game.players) {
    if (p.type !== "PLAYER") continue;
    if (p.down) continue;

    let bleedTotal = 0;
    let otherTotal = 0;
    const kept = [];

    for (const d of p.dots) {
      if (d.type === "BLEED") {
        bleedTotal += d.value;
      } else {
        otherTotal += d.value;
      }
      d.turns -= 1;
      if (d.turns > 0) kept.push(d);
    }
    p.dots = kept;

    if (bleedTotal === 0 && otherTotal === 0) continue;

    // 대신 받을 대상 결정: 불굴 > 수호 > 본인
    let actualTarget = p;
    let redirectReason = null;

    if (tankAll && tankAll.id !== p.id) {
      actualTarget = tankAll;
      redirectReason = "불굴";
    } else if (p.redirect && p.redirect.mode === "FULL") {
      const tank = game.players.find(
        (x) => x.id === p.redirect.tankId && !x.down
      );
      if (tank) {
        actualTarget = tank;
        redirectReason = "수호";
      }
    }

    dotDamages.push({
      originalPlayer: p,
      target: actualTarget,
      bleed: bleedTotal,
      other: otherTotal,
      redirectReason,
    });
  }

  // 대상별로 피해 합산
  const damageByTarget = new Map();
  for (const dd of dotDamages) {
    const key = dd.target.id;
    if (!damageByTarget.has(key)) {
      damageByTarget.set(key, {
        target: dd.target,
        bleed: 0,
        other: 0,
        sources: [],
      });
    }
    const entry = damageByTarget.get(key);
    entry.bleed += dd.bleed;
    entry.other += dd.other;
    if (dd.redirectReason) {
      entry.sources.push({
        name: dd.originalPlayer.name,
        bleed: dd.bleed,
        other: dd.other,
        reason: dd.redirectReason,
      });
    }
  }

  // 합산된 피해 적용
  for (const [targetId, entry] of damageByTarget) {
    const t = entry.target;

    // 출혈(BLEED)은 방어 무시
    if (entry.bleed > 0) {
      const res = applyDamage(t, entry.bleed, {
        sourceText: "BLEED",
        ignoreDefense: true,
        allowFloor: t.tankingAll,
      });

      // 로그 생성
      if (entry.sources.length > 0) {
        const sourceInfo = entry.sources
          .filter((s) => s.bleed > 0)
          .map((s) => `${s.name}(${s.reason}):${s.bleed}`)
          .join(" + ");
        log(
          `🩸 ${t.name} 출혈 피해 ${entry.bleed} [${sourceInfo} + 본인] (방어 무시, 실제 ${res.dealt})`
        );
      } else {
        log(
          `🩸 ${t.name} 출혈 피해 ${entry.bleed} (방어 무시, 실제 ${res.dealt}, 보호막 ${res.absorbed})`
        );
      }

      // 인내 누적
      if (t.endure) {
        t.endure.accum += res.dealt;
        log(`   ↳ 인내 누적: +${res.dealt} (총 ${t.endure.accum})`);
      }
      if (!t.tankingAll) setDownIfNeeded(t);
    }

    // 기타 DOT는 방어 적용
    if (entry.other > 0) {
      const res = applyDamage(t, entry.other, {
        sourceText: "DOT",
        allowFloor: t.tankingAll,
      });

      if (entry.sources.length > 0) {
        const sourceInfo = entry.sources
          .filter((s) => s.other > 0)
          .map((s) => `${s.name}(${s.reason}):${s.other}`)
          .join(" + ");
        log(
          `🩸 ${t.name} DOT 피해 ${entry.other} [${sourceInfo} + 본인] (실제 ${res.dealt}, 경감 ${res.mitigated})`
        );
      } else {
        log(
          `🩸 ${t.name} DOT 피해 ${entry.other} (실제 ${res.dealt}, 보호막 ${res.absorbed}, 경감 ${res.mitigated})`
        );
      }

      if (t.endure) {
        t.endure.accum += res.dealt;
        log(`   ↳ 인내 누적: +${res.dealt} (총 ${t.endure.accum})`);
      }
      if (!t.tankingAll) setDownIfNeeded(t);
    }
  }

  // 몬스터 DOT 처리 (DOT는 방어 무시)
  for (const m of game.monsters) {
    if (!m.alive) continue;
    let total = 0;
    const kept = [];
    for (const d of m.dots) {
      total += d.value;
      d.turns -= 1;
      if (d.turns > 0) kept.push(d);
    }
    if (total > 0) {
      const res = applyDamage(m, total, {
        sourceText: "DOT",
        ignoreDefense: true,
      });
      log(
        `🩸 ${m.name} DOT 피해 ${total} (방어 무시, 실제 ${res.dealt}, 보호막 ${res.absorbed})`
      );
    }
    m.dots = kept;
  }
}

function applyDebuffsToMonsterAttack(monster, base) {
  // PENANCE: reduce final attack by supporter final agi*0.5 (stored as value)
  let reduced = 0;
  for (const d of monster.debuffs) {
    if (d.type === "PENANCE") {
      reduced += d.value;
    }
  }
  return Math.max(0, base - reduced);
}

function decayDebuffsEndRound() {
  // decrement debuffs duration, remove expired
  for (const e of [...game.players, ...game.monsters]) {
    const kept = [];
    for (const d of e.debuffs) {
      d.turns -= 1;
      if (d.turns > 0) kept.push(d);
    }
    e.debuffs = kept;
    // --- ⭐ 몬스터 버프 감소 (추가 부분) ---
    if (e.buffs) {
      const keptBuffs = [];
      for (const b of e.buffs) {
        b.turns -= 1;
        if (b.turns > 0) keptBuffs.push(b);
      }
      e.buffs = keptBuffs;
    }
  }
}

/* =========================
         Logging & UI sync
      ========================= */
function log(line) {
  game.logLines.push({ time: nowTime(), text: line });
  renderBattleLog();
  renderStates();
}

function renderBattleLog() {
  const el = document.getElementById("battleLog");
  const lines = game.logLines.slice(-300);

  let html = "";
  for (const entry of lines) {
    const text = entry.text;

    // 라운드 시작
    if (text.includes("=== ROUND") && text.includes("START ===")) {
      html += `<div class="log-round">${escapeHtml(text)}</div>`;
    }
    // 섹션 구분 (--- 플레이어 턴, --- 몬스터 턴, --- 최종 합산 등)
    else if (text.startsWith("---") && text.endsWith("---")) {
      html += `<div class="log-section">${escapeHtml(
        text.replace(/---/g, "").trim()
      )}</div>`;
    }
    // 라운드 결과
    else if (text.includes("═══") && text.includes("결과")) {
      html += `<div class="log-round">${escapeHtml(text)}</div>`;
    }
    // 플레이어/몬스터 상태 요약
    else if (text.startsWith("▶") || text.startsWith("   ")) {
      html += `<div class="log-summary">${escapeHtml(text)}</div>`;
    }
    // 치명타
    else if (text.includes("CRIT!") || text.includes("치명타")) {
      html += `<div class="log-crit"><span class="log-time">[${
        entry.time
      }]</span> ${escapeHtml(text)}</div>`;
    }
    // 힐/회복
    else if (
      text.includes("💚") ||
      text.includes("회복") ||
      text.includes("회생") ||
      text.includes("가호")
    ) {
      html += `<div class="log-heal"><span class="log-time">[${
        entry.time
      }]</span> ${escapeHtml(text)}</div>`;
    }
    // 출혈/DOT
    else if (
      text.includes("🩸") ||
      text.includes("출혈") ||
      text.includes("DOT")
    ) {
      html += `<div class="log-damage"><span class="log-time">[${
        entry.time
      }]</span> ${escapeHtml(text)}</div>`;
    }
    // 스킬 발동
    else if (
      text.includes("[스킬:") ||
      text.includes("🔥") ||
      text.includes("🛡️") ||
      text.includes("⚔️") ||
      text.includes("🧱")
    ) {
      html += `<div class="log-skill"><span class="log-time">[${
        entry.time
      }]</span> ${escapeHtml(text)}</div>`;
    }
    // 들여쓰기 (↳, ↳ 등)
    else if (text.trim().startsWith("↳") || text.trim().startsWith("→")) {
      html += `<div class="log-indent">${escapeHtml(text)}</div>`;
    }
    // 공격
    else if (text.includes("🗡️") || text.includes("👹")) {
      html += `<div class="log-attack"><span class="log-time">[${
        entry.time
      }]</span> ${escapeHtml(text)}</div>`;
    }
    // 기본
    else {
      html += `<div><span class="log-time">[${
        entry.time
      }]</span> ${escapeHtml(text)}</div>`;
    }
  }

  el.innerHTML = html;
  el.scrollTop = el.scrollHeight;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;")
    .replace(/\n/g, "<br>");
}

function renderStates() {
  // Monster state
  const ms = document.getElementById("monsterState");
  if (game.monsters.length === 0) {
    ms.innerHTML = "몬스터가 없습니다.";
  } else {
    let html = "";
    for (const m of game.monsters) {
      const alive = m.alive ? "ALIVE" : "DEAD";
      const deb = m.debuffs
        .map((d) => `${d.type}:${d.value}(${d.turns})`)
        .join(", ");
      const dot = m.dots
        .map((d) => `${d.type}:${d.value}(${d.turns})`)
        .join(", ");
      const info =
        `${m.name} [${alive}] HP ${fmtHp(
          m.hp,
          m.maxHp
        )} | 공격 ${effectiveStat(m, "atk")} 방어 ${effectiveStat(
          m,
          "def"
        )} 민첩 ${effectiveStat(m, "agi")}` +
        (deb ? ` | DEBUFF {${deb}}` : "") +
        (dot ? ` | DOT {${dot}}` : "");
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid var(--line);">
        <span style="flex:1;font-size:11px;">${info}</span>
        <button onclick="deleteMonster('${m.id}')" style="background:#ff5d5d;border:none;color:#fff;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:10px;margin-left:8px;">✕</button>
      </div>`;
    }
    ms.innerHTML = html;
  }

  // Player state
  const ps = document.getElementById("playerState");
  if (game.players.length === 0) {
    ps.innerHTML = "플레이어가 없습니다.";
  } else {
    let html = "";
    for (const p of game.players) {
      const state = p.down ? `DOWN(${p.downCounter})` : "OK";
      const shields = p.shields
        .map((s) => `${Math.floor(s.value)}@R${s.expiresRound}`)
        .join(",");
      const deb = p.debuffs
        .map((d) => `${d.type}:${d.value}(${d.turns})`)
        .join(", ");
      const dot = p.dots
        .map((d) => `${d.type}:${d.value}(${d.turns})`)
        .join(", ");
      const info =
        `${p.name} [${
          ROLE_LABEL[p.role] || p.role
        }] [${state}] HP ${fmtHp(p.hp, p.maxHp)} | 체력 ${effectiveStat(
          p,
          "vit"
        )} 공격 ${effectiveStat(p, "atk")} 방어 ${effectiveStat(
          p,
          "def"
        )} 민첩 ${effectiveStat(p, "agi")} | 치명타율 ${critChance(p)}%` +
        (shields ? ` | SHIELD {${shields}}` : "") +
        (deb ? ` | DEBUFF {${deb}}` : "") +
        (dot ? ` | DOT {${dot}}` : "") +
        (p.ultUsed ? ` | ULT USED` : "");
      html += `<div style="display:flex;justify-content:space-between;align-items:center;padding:2px 0;border-bottom:1px solid var(--line);">
        <span style="flex:1;font-size:11px;">${info}</span>
        <button onclick="deletePlayer('${p.id}')" style="background:#ff5d5d;border:none;color:#fff;padding:2px 6px;border-radius:4px;cursor:pointer;font-size:10px;margin-left:8px;">✕</button>
      </div>`;
    }
    ps.innerHTML = html;
  }

  // round chips
  document.getElementById(
    "roundChip"
  ).textContent = `ROUND ${game.round}`;
  document.getElementById(
    "phaseChip"
  ).textContent = `PHASE: ${game.phase}`;

  // clear expired shields at render (based on round)
  for (const p of game.players) {
    p.shields = p.shields.filter((s) => s.expiresRound >= game.round);
  }
}

function renderPlayerActionCards() {
  const wrap = document.getElementById("playerActionCards");
  wrap.innerHTML = "";

  const aliveMonsters = game.monsters.filter((m) => m.alive);
  const alivePlayers = game.players.filter((p) => !p.down);

  for (const p of game.players) {
    const card = document.createElement("div");
    card.className = "card";

    const title = document.createElement("div");
    title.className = "row";
    title.style.justifyContent = "space-between";
    title.innerHTML = `
            <div>
              <h3 style="margin:0">${p.name} <small class="mono">(${
      p.role
    })</small></h3>
              <small>${
                p.down
                  ? `<span class="danger">DOWN</span> (대기 ${p.downCounter})`
                  : `HP ${p.hp}/${p.maxHp} | CRIT ${critChance(p)}%`
              }</small>
            </div>
            <div class="rightMeta">
              <span class="chip">액티브: ${p.actives
                .map((k) => skillName(p.role, k))
                .join(" / ")}</span>
              <span class="chip">궁극: ${skillName(p.role, p.ult)}</span>
            </div>
          `;
    card.appendChild(title);

    const disabled = game.phase !== "PLAYER" || p.down;

    const actionKey = `action_${p.id}`;
    const skillKey = `skill_${p.id}`;
    const t1Key = `t1_${p.id}`;
    const t2Key = `t2_${p.id}`;
    const statKey = `stat_${p.id}`;

    card.innerHTML += `
            <div class="actionRow">
              <div>
                <label>행동</label>
                <select id="${actionKey}" ${disabled ? "disabled" : ""}>
                  <option value="ATTACK">공격</option>
                  <option value="DEFEND">방어</option>
                  <option value="ACTIVE">액티브</option>
                  <option value="ULT">궁극기</option>
                </select>
              </div>
              <div>
                <label>스킬(액티브/궁극기)</label>
                <select id="${skillKey}" ${
      disabled ? "disabled" : ""
    }></select>
              </div>
              <div>
                <label>대상 1</label>
                <select id="${t1Key}" ${
      disabled ? "disabled" : ""
    }></select>
              </div>
              <div>
                <label>대상 2 / (필요 시)</label>
                <select id="${t2Key}" ${
      disabled ? "disabled" : ""
    }></select>
              </div>
              <div style="grid-column:1 / -1">
                <label>격려 스탯 선택(서포터 격려 시)</label>
                <select id="${statKey}" ${disabled ? "disabled" : ""}>
                  <option value="atk">공격</option>
                  <option value="def">방어</option>
                  <option value="agi">민첩</option>
                  <option value="vit">체력</option>
                </select>
              </div>
            </div>
          `;

    wrap.appendChild(card);

    // fill skill dropdown based on action
    const actionSel = document.getElementById(actionKey);
    const skillSel = document.getElementById(skillKey);
    const t1Sel = document.getElementById(t1Key);
    const t2Sel = document.getElementById(t2Key);
    const statSel = document.getElementById(statKey);

    function fillTargets(mode) {
      // mode: based on selected skill target requirement
      const allies = game.players.map((x) => ({
        id: x.id,
        name: x.name,
        down: x.down,
      }));
      const enemies = game.monsters.map((x) => ({
        id: x.id,
        name: x.name,
        alive: x.alive,
      }));

      function setOptions(selectEl, options, placeholder) {
        selectEl.innerHTML = "";
        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = placeholder;
        selectEl.appendChild(ph);
        for (const o of options) {
          const opt = document.createElement("option");
          opt.value = o.id;
          opt.textContent = o.label;
          selectEl.appendChild(opt);
        }
      }

      const allyOpts = allies
        .filter((a) => !a.down)
        .map((a) => ({ id: a.id, label: `${a.name}` }));

      const allyAllOpts = allies.map((a) => ({
        id: a.id,
        label: `${a.name}${a.down ? " (DOWN)" : ""}`,
      }));

      const enemyOpts = enemies
        .filter((e) => e.alive)
        .map((e) => ({ id: e.id, label: `${e.name}` }));

      if (mode === "ENEMY1") {
        setOptions(t1Sel, enemyOpts, "몬스터 선택");
        setOptions(t2Sel, [], "미사용");
      } else if (mode === "ENEMY_ALL") {
        setOptions(t1Sel, [{ id: "ALL", label: "전체 몬스터" }], "전체");
        setOptions(t2Sel, [], "미사용");
      } else if (mode === "ALLY1") {
        setOptions(t1Sel, allyOpts, "아군 선택");
        setOptions(t2Sel, [], "미사용");
      } else if (mode === "ALLY2") {
        setOptions(t1Sel, allyOpts, "아군1");
        setOptions(t2Sel, allyOpts, "아군2");
      } else if (mode === "ALLY_ALL") {
        setOptions(t1Sel, [{ id: "ALL", label: "전체 아군" }], "전체");
        setOptions(t2Sel, [], "미사용");
      } else if (mode === "ALLY1_STAT") {
        setOptions(t1Sel, allyOpts, "아군 선택");
        setOptions(t2Sel, [], "미사용");
      } else if (mode === "NONE") {
        setOptions(t1Sel, [], "미사용");
        setOptions(t2Sel, [], "미사용");
      } else {
        // default
        setOptions(t1Sel, enemyOpts, "대상 선택");
        setOptions(t2Sel, [], "미사용");
      }

      statSel.disabled =
        !(
          p.role === "SUPPORT" &&
          skillSel.value === "ENCOURAGE" &&
          actionSel.value === "ACTIVE"
        ) || disabled;
    }

    function fillSkills() {
      skillSel.innerHTML = "";
      const action = actionSel.value;

      const opt = (val, txt) => {
        const o = document.createElement("option");
        o.value = val;
        o.textContent = txt;
        return o;
      };

      if (action === "ACTIVE") {
        skillSel.appendChild(opt("", "액티브 선택"));
        for (const k of p.actives) {
          skillSel.appendChild(opt(k, skillName(p.role, k)));
        }
      } else if (action === "ULT") {
        skillSel.appendChild(
          opt(
            p.ult,
            `${skillName(p.role, p.ult)}${p.ultUsed ? " (사용됨)" : ""}`
          )
        );
      } else {
        skillSel.appendChild(opt("", "스킬 없음"));
      }

      // default targets based on selection
      const targetType = getSkillTargetType(
        p,
        actionSel.value,
        skillSel.value
      );
      fillTargets(targetType);
    }

    actionSel.addEventListener("change", () => fillSkills());
    skillSel.addEventListener("change", () => {
      const targetType = getSkillTargetType(
        p,
        actionSel.value,
        skillSel.value
      );
      fillTargets(targetType);
    });

    // initialize from saved action if exists
    fillSkills();

    const saved = game.actions.get(p.id);
    if (saved) {
      actionSel.value = saved.type;
      fillSkills();
      if (saved.type === "ACTIVE" || saved.type === "ULT") {
        if (saved.skillKey) skillSel.value = saved.skillKey;
      }
      if (saved.t1) t1Sel.value = saved.t1;
      if (saved.t2) t2Sel.value = saved.t2;
      if (saved.stat) statSel.value = saved.stat;
      // re-evaluate targets for stat selector
      const targetType = getSkillTargetType(
        p,
        actionSel.value,
        skillSel.value
      );
      fillTargets(targetType);
    }

    // save on any change
    const save = () => {
      const a = {
        type: actionSel.value,
        skillKey:
          actionSel.value === "ACTIVE" || actionSel.value === "ULT"
            ? skillSel.value
            : null,
        t1: t1Sel.value || null,
        t2: t2Sel.value || null,
        stat: statSel.value || "atk",
      };
      game.actions.set(p.id, a);
      updateReadyChip();
    };

    [actionSel, skillSel, t1Sel, t2Sel, statSel].forEach((el) =>
      el.addEventListener("change", save)
    );
    updateReadyChip();
  }
}

function updateReadyChip() {
  const total = game.players.filter((p) => !p.down).length;
  let ready = 0;
  for (const p of game.players) {
    if (p.down) continue;
    const a = game.actions.get(p.id);
    if (!a) continue;
    // minimal validation: ATTACK/DEFEND always ready; ACTIVE needs skillKey; ULT ready even if used (will fail in resolve)
    if (a.type === "ATTACK" || a.type === "DEFEND") ready++;
    else if (a.type === "ACTIVE") {
      if (a.skillKey) ready++;
    } else if (a.type === "ULT") {
      ready++;
    }
  }
  document.getElementById(
    "readyChip"
  ).textContent = `READY: ${ready}/${total}`;
}

function skillName(role, key) {
  const pool = [...SKILLS[role].active, ...SKILLS[role].ult];
  const s = pool.find((x) => x.key === key);
  return s ? s.name : key;
}

function getSkillTargetType(player, actionType, skillKey) {
  if (actionType === "ACTIVE") {
    const s = SKILLS[player.role].active.find((x) => x.key === skillKey);
    return s ? s.target : "NONE";
  }
  if (actionType === "ULT") {
    const s = SKILLS[player.role].ult.find((x) => x.key === skillKey);
    return s ? s.target : "NONE";
  }
  // attack defaults to ENEMY1
  if (actionType === "ATTACK") return "ENEMY1";
  return "NONE";
}

/* =========================
         Monster Intent
      ========================= */
function chooseMonsterIntent() {
  const aliveMonsters = game.monsters.filter((m) => m.alive);
  const alivePlayers = game.players.filter((p) => !p.down);

  if (aliveMonsters.length === 0) return null;
  if (alivePlayers.length === 0) return null;

  // 어그로가 있는 플레이어 찾기
  const aggroPlayers = alivePlayers.filter((p) => p.hasAggro);

  // 어그로 적용 타겟 선택 함수
  function selectTargetsWithAggro(count) {
    const selected = [];
    const available = [...alivePlayers];

    for (let i = 0; i < count && available.length > 0; i++) {
      // 어그로가 있는 플레이어가 아직 선택되지 않았다면 50% 확률로 우선 선택
      const unselectedAggro = aggroPlayers.filter(
        (ap) => available.includes(ap) && !selected.includes(ap)
      );

      if (unselectedAggro.length > 0 && Math.random() < 0.5) {
        const aggroTarget =
          unselectedAggro[
            Math.floor(Math.random() * unselectedAggro.length)
          ];
        selected.push(aggroTarget);
        available.splice(available.indexOf(aggroTarget), 1);
      } else {
        // 일반 랜덤 선택
        const idx = Math.floor(Math.random() * available.length);
        selected.push(available[idx]);
        available.splice(idx, 1);
      }
    }
    return selected;
  }

  // choose a monster to act this round (if multiple, all act; intent shows aggregated)
  // We'll create per-monster intent list, but show summary text.
  const intents = [];

  for (const m of aliveMonsters) {
    // 몬스터별 패턴 비율 사용
    const pat = m.patterns || { single: 25, aoe: 25, bleed: 25, buff: 25 };
    const total = pat.single + pat.aoe + pat.bleed + pat.buff;
    
    // total이 0이면 기본 단일 공격
    if (total === 0) {
      const targets = selectTargetsWithAggro(1);
      const t = targets[0];
      intents.push({
        monsterId: m.id,
        type: "SINGLE",
        targetIds: [t.id],
        text: `${m.name}는 ${t.name}(을)를 노려보고 있다. (단일 공격)`,
      });
      continue;
    }
    
    const singleThreshold = pat.single / total;
    const aoeThreshold = singleThreshold + pat.aoe / total;
    const bleedThreshold = aoeThreshold + pat.bleed / total;
    
    const r = Math.random();
    
    if (r < singleThreshold) {
      // 단일 공격 - 어그로 적용
      const targets = selectTargetsWithAggro(1);
      const t = targets[0];
      intents.push({
        monsterId: m.id,
        type: "SINGLE",
        targetIds: [t.id],
        text: `${m.name}는 ${t.name}(을)를 노려보고 있다. (단일 공격)`,
      });
    } else if (r < aoeThreshold) {
      // 광역공격 2~4인 - 어그로 적용
      const n = Math.min(
        alivePlayers.length,
        Math.floor(Math.random() * 3) + 2
      );
      const targets = selectTargetsWithAggro(n);
      const targetNames = targets.map((t) => t.name).join(", ");

      intents.push({
        monsterId: m.id,
        type: "AOE",
        targetIds: targets.map((x) => x.id),
        text: `${m.name}는 ${targetNames}(을)를 향해 눈을 굴리고 있다. (광역 ${n}인)`,
      });
    } else if (r < bleedThreshold) {
      // bleeding 2~3 - 어그로 적용
      const n = Math.min(
        alivePlayers.length,
        Math.floor(Math.random() * 2) + 2
      );
      const targets = selectTargetsWithAggro(n);
      const targetNames = targets.map((t) => t.name).join(", ");
      intents.push({
        monsterId: m.id,
        type: "BLEED",
        targetIds: targets.map((x) => x.id),
        text: `${targetNames}을(를) 노려보고 있는 ${m.name}은 옷과 피부를 찢어버릴 태세이다. (출혈 ${n}인, 3턴 지속, 방어 무시)`,
      });
    } else if (pat.buff > 0) {
      // self buff - 버프 비율이 0보다 클 때만
      const stats = ["atk", "def", "agi"];
      const s = stats[Math.floor(Math.random() * stats.length)];
      intents.push({
        monsterId: m.id,
        type: "BUFF",
        buffStat: s,
        text: `${
          m.name
        }는 한발 물러서서 태세를 재정비합니다. (자가버프: ${s.toUpperCase()})`,
      });
    } else {
      // fallback: 버프가 0%인데 여기까지 왔으면 단일 공격
      const targets = selectTargetsWithAggro(1);
      const t = targets[0];
      intents.push({
        monsterId: m.id,
        type: "SINGLE",
        targetIds: [t.id],
        text: `${m.name}는 ${t.name}(을)를 노려보고 있다. (단일 공격)`,
      });
    }
  }

  return intents;
}

/* =========================
         Round Flow
      ========================= */
function startRound() {
  if (game.players.length === 0) {
    log("⚠️ 플레이어를 먼저 추가하세요.");
    return;
  }
  if (game.monsters.length === 0) {
    log("⚠️ 몬스터를 먼저 추가하세요.");
    return;
  }
  if (game.phase !== "HINT" && game.phase !== "RESOLVE") {
    log(
      "⚠️ 현재 라운드가 진행 중입니다. (라운드 합산 후 다음 라운드 시작)"
    );
    return;
  }

  // round start: revive counters, apply pending buffs
  log(`\n=== ROUND ${game.round} START ===`);
  for (const p of game.players) {
    reviveIfReady(p);
  }
  // DOT 틱은 resolveRound에서 플레이어 행동 후 처리 (불굴 등 스킬 적용을 위해)

  // clear per-round flags
  for (const p of game.players) {
    p._defendBonus = 0;
    p.minHpFloor = false;
    p.tankingAll = false;
    p.redirect = null; // reset; will be set by skills
  }
  for (const m of game.monsters) {
    // none for now
  }

  // generate monster intent(s)
  game.monsterIntents = chooseMonsterIntent();
  if (!game.monsterIntents) {
    log("전투를 진행할 수 없습니다. (대상 없음)");
    return;
  }

  const hintText = game.monsterIntents
    .map((x) => "- " + x.text)
    .join("\n");
  document.getElementById("hintBox").textContent = hintText;
  log(`몬스터 행동 암시:\n${hintText}`);

  // phase to PLAYER
  game.phase = "PLAYER";
  renderPlayerActionCards();
  renderStates();
}

function resolveRound() {
  if (game.phase !== "PLAYER") {
    log("⚠️ 먼저 '라운드 시작(암시)' 후, 중앙에서 행동을 선택하세요.");
    return;
  }

  const alivePlayers = game.players.filter((p) => !p.down);
  if (alivePlayers.length === 0) {
    log("⚠️ 행동 가능한 플레이어가 없습니다.");
    return;
  }

  // 합산 전 상태 스냅샷 저장 (되돌리기용)
  saveSnapshot();

  // 라운드 시작 시 HP 저장 (피해량 계산용)
  for (const p of game.players) {
    p._hpAtRoundStart = p.hp;
  }
  for (const m of game.monsters) {
    m._hpAtRoundStart = m.hp;
  }

  // validation: ensure actions exist
  for (const p of alivePlayers) {
    if (!game.actions.get(p.id)) {
      game.actions.set(p.id, {
        type: "ATTACK",
        skillKey: null,
        t1: null,
        t2: null,
        stat: "atk",
      });
    }
  }

  game.phase = "RESOLVE";
  renderStates();

  // 1) Apply player DEFEND bonuses first (so monster damage mitigation works)
  for (const p of alivePlayers) {
    const a = game.actions.get(p.id);
    if (a?.type === "DEFEND") {
      const bonus = finalStat(p, "def");
      p._defendBonus = bonus;
      log(`🛡️ ${p.name} 방어: 추가 경감 ${bonus}`);
    }
  }

  // 2) Resolve PLAYER actions (in simple order; you can change to AGI ordering)
  log(`--- 플레이어 턴 (${alivePlayers.length}인) ---`);
  for (const p of alivePlayers) {
    const a = game.actions.get(p.id);
    resolvePlayerAction(p, a);
  }

  // 2.5) DOT 틱 - 플레이어 행동 후 (불굴 등 스킬이 적용된 상태에서)
  log(`--- DOT 피해 ---`);
  tickDots();

  // 3) Resolve MONSTER actions
  log(`--- 몬스터 턴 ---`);
  resolveMonsterActions();

  // 4) End of round: cleanup, decay debuffs, check downs, summary
  for (const p of game.players) {
    setDownIfNeeded(p);
  }
  decayDebuffsEndRound();

  log(`--- 최종 합산 ---`);
  summarizeRound();

  // prepare next
  game.round += 1;
  game.phase = "HINT";
  game.actions.clear();
  game.monsterIntents = null;

  renderPlayerActionCards();
  renderStates();
}

function summarizeRound() {
  log(`\n📊 ═══ 라운드 ${game.round} 결과 ═══`);

  // 플레이어 합산
  log(`\n▶ 플레이어 상태:`);
  for (const p of game.players) {
    const startHp = p._hpAtRoundStart ?? p.hp;
    const damageTaken = Math.max(0, startHp - p.hp);
    const healed = Math.max(0, p.hp - startHp);
    const status = p.down ? " [DOWN]" : "";
    const pct = p.maxHp > 0 ? Math.round((p.hp / p.maxHp) * 100) : 0;

    let changeText = "";
    if (damageTaken > 0) {
      changeText = ` (받은 피해: ${damageTaken})`;
    } else if (healed > 0) {
      changeText = ` (회복: +${healed})`;
    }

    log(
      `   ${p.name}${status}: HP ${p.hp}/${p.maxHp} (${pct}%)${changeText}`
    );
  }

  // 몬스터 합산
  log(`\n▶ 몬스터 상태:`);
  let totalDamageToMonsters = 0;
  for (const m of game.monsters) {
    const startHp = m._hpAtRoundStart ?? m.hp;
    const damageDealt = Math.max(0, startHp - m.hp);
    totalDamageToMonsters += damageDealt;
    const status = m.alive ? "" : " [DEAD]";
    const pct = m.maxHp > 0 ? Math.round((m.hp / m.maxHp) * 100) : 0;

    let changeText =
      damageDealt > 0 ? ` (받은 피해: ${damageDealt})` : "";

    log(
      `   ${m.name}${status}: HP ${m.hp}/${m.maxHp} (${pct}%)${changeText}`
    );
  }

  // 총합
  const aliveM = game.monsters.filter((m) => m.alive).length;
  const downP = game.players.filter((p) => p.down).length;
  log(
    `\n▶ 총합: 몬스터에게 준 피해량 ${totalDamageToMonsters} | 몬스터 생존 ${aliveM}/${game.monsters.length} | 플레이어 다운 ${downP}/${game.players.length}`
  );
  log(`═══════════════════════════\n`);
}

/* =========================
         Player Action Resolution
      ========================= */
function resolvePlayerAction(p, a) {
  if (!a)
    a = {
      type: "ATTACK",
      skillKey: null,
      t1: null,
      t2: null,
      stat: "atk",
    };

  if (a.type === "ATTACK") {
    const target = pickMonsterById(a.t1) || firstAliveMonster();
    if (!target) {
      log(`⚠️ ${p.name} 공격 실패: 대상 없음`);
      return;
    }
    doAttack(p, target, {
      mult: 1.0,
      ignoreDefense: false,
      label: "기본공격",
    });
    p.lastActiveKey = null; // 기본공격 시 액티브 연속 사용 체크 리셋
    return;
  }

  if (a.type === "DEFEND") {
    // already applied bonus; nothing else
    p.lastActiveKey = null; // 방어 시 액티브 연속 사용 체크 리셋
    return;
  }

  if (a.type === "ACTIVE") {
    const key = a.skillKey;
    if (!key) {
      log(`⚠️ ${p.name} 액티브 미선택 → 기본공격으로 대체`);
      const target = firstAliveMonster();
      if (target) doAttack(p, target, { mult: 1.0, label: "기본공격" });
      p.lastActiveKey = null; // 기본공격으로 대체 시에도 리셋
      return;
    }
    // consecutive active check
    if (p.lastActiveKey === key) {
      log(
        `⚠️ ${p.name} 액티브 연속 사용 불가(${skillName(
          p.role,
          key
        )}) → 기본공격으로 대체`
      );
      const target = firstAliveMonster();
      if (target) doAttack(p, target, { mult: 1.0, label: "기본공격" });
      p.lastActiveKey = null; // 연속 사용 실패 시에도 리셋
      return;
    }
    resolveSkill(p, "ACTIVE", key, a);
    p.lastActiveKey = key;
    return;
  }

  if (a.type === "ULT") {
    const key = p.ult;
    if (p.ultUsed) {
      log(
        `⚠️ ${p.name} 궁극기(${skillName(
          p.role,
          key
        )})는 이미 사용됨 → 기본공격으로 대체`
      );
      const target = firstAliveMonster();
      if (target) doAttack(p, target, { mult: 1.0, label: "기본공격" });
      p.lastActiveKey = null; // 궁극기 실패 시에도 리셋
      return;
    }
    resolveSkill(p, "ULT", key, a);
    p.ultUsed = true;
    p.lastActiveKey = null; // 궁극기 사용 시 액티브 연속 사용 체크 리셋
    return;
  }
}

function doAttack(
  attacker,
  target,
  {
    mult = 1.0,
    ignoreDefense = false,
    label = "공격",
    diceTwice = false,
    diceSum = false,
    fixed = null,
  } = {}
) {
  if (target.type === "MONSTER" && !target.alive) {
    log(
      `⚠️ ${attacker.name} ${label}: 대상 ${target.name}은 이미 사망했습니다.`
    );
    return;
  }
  let raw = 0;
  let atkFormula = "";

  if (fixed !== null) {
    raw = fixed;
    atkFormula = `고정 피해 ${fixed}`;
  } else {
    if (diceTwice) {
      const atk = effectiveStat(attacker, "atk");
      const r1 = d6(),
        r2 = d6();
      const base = atk * r1 + atk * r2;
      raw = base;
      atkFormula = `공격 ${atk}×${r1}(1d6) + ${atk}×${r2}(1d6)=${base}`;
    } else {
      const atkResult = baseAttackDamage(attacker);
      raw = atkResult.damage;
      atkFormula = `공격 ${atkResult.atk}×${atkResult.roll}(1d6)=${raw}`;
    }
  }

  if (mult !== 1.0) {
    const beforeMult = raw;
    raw = raw * mult;
    atkFormula += ` ×${mult}=${Math.floor(raw)}`;
  }

  // crit
  const c = pct(critChance(attacker));
  if (c && fixed === null) {
    // fixed damage does not crit
    raw = raw * 2;
    atkFormula += ` ×2(치명타)=${Math.floor(raw)}`;
    log(`✨ CRIT! ${attacker.name} (${label})`);
  }

  raw = Math.floor(raw);

  const res = applyDamage(target, raw, { ignoreDefense });

  let logMsg = `🗡️ ${attacker.name} → ${target.name} (${label})\n`;
  logMsg += `   [${atkFormula}]`;
  if (!ignoreDefense && res.defFormula) {
    logMsg += `\n   [${res.defFormula}]`;
  }
  if (ignoreDefense) {
    logMsg += ` (방어 무시)`;
  }
  logMsg += `\n   → 데미지 ${raw}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
  log(logMsg);

  // if attacker is tank with ENDURE active, we count damage taken not dealt; handled elsewhere.
}

/* =========================
         Skills
      ========================= */
function resolveSkill(p, type, key, a) {
  // Pre-checks: targets existence
  const role = p.role;

  if (role === "TANK") {
    if (type === "ULT" && key === "UNYIELDING") {
      // all incoming damage + debuffs -> tank; hp floor 1
      p.tankingAll = true;
      p.minHpFloor = true;
      log(
        `🛡️ ${p.name} [궁극기:불굴] 발동! (1턴 전체 데미지를 대신 받아내지만 쓰러지지 않습니다!)`
      );
      return;
    }
    if (type === "ULT" && key === "DEVOTION") {
      const def = effectiveStat(p, "def");
      const roll = d6();
      const dmg = def * roll * 2;
      log(
        `💥 ${p.name} [궁극기:헌신]이 발동!\n   [방어 ${def}×${roll}(1d6)×2=${dmg}] 자신 HP 전부 소모 후 적 전체 공격`
      );
      // attack first, then drop
      for (const m of game.monsters.filter((m) => m.alive)) {
        const res = applyDamage(m, dmg, { ignoreDefense: false });
        let logMsg = `   ↳ ${m.name}`;
        if (res.defFormula) logMsg += ` [${res.defFormula}]`;
        logMsg += ` 피해 ${dmg}, 실제 ${res.dealt}, 보호막 ${res.absorbed}, 경감 ${res.mitigated}`;
        log(logMsg);
      }
      p.hp = 0;
      setDownIfNeeded(p);
      return;
    }

    if (type === "ACTIVE" && key === "GUARD") {
      const t1 = pickPlayerById(a.t1);
      const t2 = pickPlayerById(a.t2);
      const targets = [t1, t2].filter(
        (x) => x && !x.down && x.id !== p.id
      );
      if (targets.length === 0) {
        log(`⚠️ ${p.name}의 [스킬:호위] 실패: 대상 없음 → 기본공격`);
        const m = firstAliveMonster();
        if (m) doAttack(p, m, { label: "기본공격" });
        return;
      }
      const def = effectiveStat(p, "def");
      const roll = d6();
      const fDef = def * roll;
      let baseShield = Math.floor(fDef * 0.8);
      let shield = baseShield;
      let critText = "";

      // 크리티컬 체크
      if (pct(critChance(p))) {
        shield = shield * 2;
        critText = ` ×2(치명타)=${shield}`;
        log(`✨ CRIT! ${p.name} (호위)`);
      }

      log(
        `🛡️ ${p.name}의 [호위] 스킬 발동\n   [방어 ${def}×${roll}(1d6)×0.8=${baseShield}${critText} 보호막]`
      );
      for (const t of targets) {
        // no stacking same active: just add shield but you can choose to overwrite; here we add.
        t.shields.push({ value: shield, expiresRound: game.round });
        log(
          `   ↳ ${p.name}의 [호위] 스킬로 ${t.name}에게 보호막 ${shield} 부여 (R${game.round}까지)`
        );
      }
      return;
    }

    if (type === "ACTIVE" && key === "PROTECT") {
      const ally = pickPlayerById(a.t1);
      if (!ally || ally.down || ally.id === p.id) {
        log(`⚠️ ${p.name} 수호 실패: 유효 아군 없음 → 기본공격`);
        const m = firstAliveMonster();
        if (m) doAttack(p, m, { label: "기본공격" });
        return;
      }

      // 1d6 다이스 굴림
      const roll = d6();
      const def = effectiveStat(p, "def");
      
      // 기본 수식: def × 1.3 × roll
      let baseDefBonus = Math.floor(def * 1.3 * roll);
      let finalDefBonus = baseDefBonus;
      let critText = "";
      
      // 크리티컬 체크 - 최종 결과 ×2
      if (pct(critChance(p))) {
        finalDefBonus = baseDefBonus * 2;
        critText = ` ×2(치명타)=${finalDefBonus}`;
        log(`✨ CRIT! ${p.name} (수호)`);
      }

      // "이번 턴"만 유효한 풀 리다이렉트
      ally.redirect = {
        tankId: p.id,
        mode: "FULL",
        defBonus: finalDefBonus, // 방어 보너스로 변경
        expiresRound: game.round,
      };

      log(
        `🛡️ ${p.name} 의 [수호] 스킬 사용! → ${ally.name}\n   [방어 ${def}×1.3×${roll}(1d6)=${baseDefBonus}${critText}] 방어 보너스 적용`
      );
      return;
    }

    if (type === "ACTIVE" && key === "ENDURE") {
      p.endure = { accum: 0, turnsLeft: 3 };
      p.hasAggro = true; // 어그로 증가 (50% 확률로 타겟에 포함)
      log(
        `🧱 ${p.name}의 [인내] 스킬 시작: 3턴 누적 피해만큼 랜덤 몬스터에게 0.5배를 데미지를 반사합니다.`
      );
      return;
    }

    if (type === "ACTIVE" && key === "FIGHTING_SPIRIT") {
      const m = pickMonsterById(a.t1) || firstAliveMonster();
      if (!m) {
        log(`⚠️ ${p.name} [스킬:투혼] 실패: 대상 없음 → 기본공격`);
        const mm = firstAliveMonster();
        if (mm) doAttack(p, mm, { label: "기본공격" });
        return;
      }

      // 2턴간 방어 -5 (이번 턴 + 다음 턴)
      p.fightingSpirit = { turnsLeft: 2 };

      log(
        `🔥 ${p.name}의 [스킬:투혼] 발동! ${m.name}에게 고정 50 (방어 무시), 2턴간 DEF -3`
      );

      // 즉시 고정 50 데미지 (방어 무시, 1회만)
      doAttack(p, m, {
        fixed: 50,
        label: "투혼(고정)",
        ignoreDefense: true,
      });
      return;
    }
  }

  if (role === "DPS") {
    if (type === "ULT" && key === "MERCY") {
      const m = pickMonsterById(a.t1) || firstAliveMonster();
      if (!m) {
        log(
          `⚠️ ${p.name}의 [궁극기:자비]가 실패로 끝납니다. 대상이 없습니다.`
        );
        return;
      }
      // attack dice twice sum then *2
      doAttack(p, m, { diceTwice: true, mult: 2.5, label: "자비" });
      return;
    }
    if (type === "ULT" && key === "CHARGE") {
      const m = pickMonsterById(a.t1) || firstAliveMonster();
      if (!m) {
        log(`⚠️ ${p.name} [궁극기:돌격]이 실패합니다. 대상이 없습니다.`);
        return;
      }
      doAttack(p, m, {
        mult: 2,
        ignoreDefense: true,
        diceTwice: true,
        label: "돌격(방어무시)",
      });
      return;
    }

    if (type === "ACTIVE" && key === "MADNESS") {
      p.pendingAtkPlusNext += 3;
      log(
        `😈 ${p.name}의 [스킬:광기]가 발동됩니다. 다음 턴 공격 스탯 +3 (누적 ${p.pendingAtkPlusNext})`
      );
      return;
    }

    if (type === "ACTIVE" && key === "OBSESSION") {
      const m = pickMonsterById(a.t1) || firstAliveMonster();
      if (!m) {
        log(`⚠️ ${p.name} [스킬:집념]이 실패했습니다. 대상이 없습니다.`);
        return;
      }
      const atkResult = baseAttackDamage(p);
      const dotVal = Math.floor(atkResult.damage * 0.8);
      addDot(m, {
        type: "OBSESSION",
        value: dotVal,
        turns: 3,
        sourceId: p.id,
      });
      log(
        `🩸 ${p.name} 집념 → ${m.name}\n   [공격 ${atkResult.atk}×${atkResult.roll}(1d6)×0.8=${dotVal}] DOT ${dotVal}/턴 ×3턴 (중첩 가능)`
      );
      return;
    }

    if (type === "ACTIVE" && key === "BLOODFIGHT") {
      const m = pickMonsterById(a.t1) || firstAliveMonster();
      if (!m) {
        log(`⚠️ ${p.name} 혈투 실패: 대상 없음`);
        return;
      }
      const cost = Math.ceil(p.hp * 0.3);
      p.hp = Math.max(0, p.hp - cost);
      log(`🩸 ${p.name} [스킬:혈투] 발동!: HP ${cost} 가 소모됩니다!`);
      setDownIfNeeded(p);
      if (p.down) {
        log(
          `⚠️ ${p.name}이(가)[스킬:혈투]를 사용했으나 다운되어 공격이 불발되었습니다!`
        );
        return;
      }
      doAttack(p, m, { mult: 2, label: "혈투" });
      return;
    }

    if (type === "ACTIVE" && key === "MASSACRE") {
      const atk = effectiveStat(p, "atk");
      const roll = d6();
      const fAtk = atk * roll;
      const dmg = Math.floor(fAtk * 1.5);
      log(
        `⚔️ ${p.name} 의 스킬 참살 발동!: 적 전체 공격\n   [공격 ${atk}×${roll}(1d6)×1.5=${dmg}]`
      );
      for (const mm of game.monsters.filter((x) => x.alive)) {
        const res = applyDamage(mm, dmg, { ignoreDefense: false });
        let logMsg = `   ↳ ${mm.name}`;
        if (res.defFormula) logMsg += ` [${res.defFormula}]`;
        logMsg += ` 데미지 ${dmg}, 실제 피해량 ${res.dealt} (보호막 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
        log(logMsg);
      }
      return;
    }
  }

  if (role === "SUPPORT") {
    if (type === "ULT" && key === "REINCARNATION") {
      const ally = pickPlayerById(a.t1);
      if (!ally) {
        log(`⚠️ ${p.name} 윤회 실패: 대상 없음`);
        return;
      }
      ally.ultUsed = false;
      log(
        `🔄 ${p.name} [궁극기 스킬:윤회]가 발동! → ${ally.name} 궁극기 사용 가능으로 초기화`
      );
      return;
    }
    if (type === "ULT" && key === "REST") {
      log(
        `🌿 ${p.name} [궁극기 스킬:안식] 발동! 전체 회복 + 다운 대기 제거 + 전체 액티브 재사용 초기화!`
      );
      for (const ally of game.players) {
        // revive downed immediately to full
        ally.down = false;
        ally.downCounter = 0;
        ally.hp = ally.maxHp;
        // 전체 액티브 연속 사용 제한 해제
        ally.lastActiveKey = null;
      }
      return;
    }

    if (type === "ACTIVE" && key === "REVIVE") {
      const ally = pickPlayerById(a.t1);
      if (!ally) {
        log(`⚠️ ${p.name} [스킬:회생] 실패! 대상 없음`);
        return;
      }
      const agi = effectiveStat(p, "agi");
      const roll = d6();
      const baseAmount = Math.floor(agi * roll * 1.5);
      let amount = baseAmount;
      let critText = "";

      // 크리티컬 체크
      if (pct(critChance(p))) {
        amount = baseAmount * 2;
        critText = ` ×2(치명타)=${amount}`;
        log(`✨ CRIT! ${p.name} (회생)`);
      }

      const healed = heal(ally, amount);
      log(
        `💚 ${p.name}가 [스킬:회생]으로 ${ally.name}\n   [민첩 ${agi}×${roll}(1d6)×1.5=${baseAmount}${critText}] 실제 회복 ${healed}`
      );
      return;
    }

    if (type === "ACTIVE" && key === "BLESS") {
      const a1 = pickPlayerById(a.t1);
      const a2 = pickPlayerById(a.t2);
      const targets = [a1, a2].filter((x) => x);
      if (targets.length === 0) {
        log(`⚠️ ${p.name} 가호 실패: 대상 없음`);
        return;
      }
      const agi = effectiveStat(p, "agi");
      const roll = d6();
      let baseAmount = Math.floor(agi * roll * 1);
      let amount = baseAmount;
      let critText = "";

      // 크리티컬 체크
      if (pct(critChance(p))) {
        amount = amount * 2;
        critText = ` ×2(치명타)=${amount}`;
        log(`✨ CRIT! ${p.name} (가호)`);
      }

      log(
        `💚 ${p.name}의 [스킬:가호] 발동\n   [민첩 ${agi}×${roll}(1d6)×1=${baseAmount}${critText}]`
      );
      for (const t of targets) {
        const healed = heal(t, amount);
        log(`   ↳ ${t.name} 실제 회복 ${healed}`);
      }
      return;
    }

    if (type === "ACTIVE" && key === "ENCOURAGE") {
      const ally = pickPlayerById(a.t1);
      if (!ally) {
        log(`⚠️ ${p.name} 격려 실패: 대상 없음`);
        return;
      }
      const stat = a.stat || "atk";
      // 다음 턴에 적용되도록 pendingEncourage에 추가
      if (!ally.pendingEncourage) ally.pendingEncourage = [];
      ally.pendingEncourage.push({
        stat: stat,
        value: 3,
        sourceId: p.id,
      });
      log(
        `📣 ${p.name}의 [스킬:격려]가 발동됩니다! → ${
          ally.name
        } ${stat.toUpperCase()} +3 (다음 턴 적용)`
      );
      return;
    }

    if (type === "ACTIVE" && key === "PURIFY") {
      const a1 = pickPlayerById(a.t1);
      const a2 = pickPlayerById(a.t2);
      const targets = [a1, a2].filter((x) => x);
      if (targets.length === 0) {
        log(`⚠️ ${p.name} 정화 실패: 대상 없음`);
        return;
      }
      for (const t of targets) {
        clearDebuffs(t);
        t.dots = [];
        log(
          `✨ ${p.name}의 [스킬:정화] → ${t.name} 디버프/DOT를 해제합니다.`
        );
      }
      return;
    }

    if (type === "ACTIVE" && key === "PENANCE") {
      const m = pickMonsterById(a.t1) || firstAliveMonster();
      if (!m) {
        log(`⚠️ ${p.name} 참회 실패: 대상 없음`);
        return;
      }
      const agi = effectiveStat(p, "agi");
      const roll = d6();
      let baseVal = Math.floor(agi * roll * 0.5);
      let val = baseVal;
      let critText = "";

      // 크리티컬 체크
      if (pct(critChance(p))) {
        val = val * 2;
        critText = ` ×2(치명타)=${val}`;
        log(`✨ CRIT! ${p.name} (참회)`);
      }

      const ok = addDebuff(m, {
        type: "PENANCE",
        value: val,
        turns: 1,
        sourceId: p.id,
      });
      if (ok) {
        log(
          `🕯️ ${p.name}의 [스킬:참회] → ${m.name}\n   [민첩 ${agi}×${roll}(1d6)×0.5=${baseVal}${critText}] 공격 -${val} (1턴, 중첩불가)`
        );
      } else {
        log(`⚠️ ${p.name} 참회 실패: 이미 적용 중 (중첩불가)`);
      }
      return;
    }
  }

  // fallback
  log(`⚠️ ${p.name} 스킬 처리 미구현(${key}) → 기본공격`);
  const target = firstAliveMonster();
  if (target) doAttack(p, target, { label: "기본공격" });
}

/* =========================
         Monster Action Resolution
      ========================= */
function resolveMonsterActions() {
  const intents = game.monsterIntents || [];
  for (const intent of intents) {
    const m = game.monsters.find((x) => x.id === intent.monsterId);
    if (!m || !m.alive) continue;

    // apply buff intent
    if (intent.type === "BUFF") {
      const inc = d5();
      const stat = intent.buffStat;

      m.buffs.push({
        stat,
        value: inc,
        turns: 2,
      });

      log(`⬆️ ${m.name} 자가버프: ${stat.toUpperCase()} +${inc} (2턴)`);
      continue;
    }

    // compute base damage scale
    // single: atk*1d6*2
    // aoe: atk*1d6 (각 대상)
    // bleed: apply DOT 1d10 x3턴 (각 대상)
    const targets = (intent.targetIds || [])
      .map((id) => pickPlayerById(id))
      .filter((x) => x);

    if (intent.type === "SINGLE") {
      const t = targets[0] || randomAlivePlayer();
      if (!t) {
        continue;
      }
      const atk = effectiveStat(m, "atk");
      const roll = d6();
      const baseRaw = atk * roll * 2;
      const raw = applyDebuffsToMonsterAttack(m, baseRaw);
      const atkFormula = `공격 ${atk}×${roll}(1d6)×2=${baseRaw}${
        raw !== baseRaw ? ` (참회 적용 후 ${raw})` : ""
      }`;
      dealMonsterDamage(m, t, raw, { label: "단일공격", atkFormula });
      continue;
    }

    if (intent.type === "AOE") {
      const targets = intent.targetIds
        .map((id) => game.players.find((p) => p.id === id))
        .filter(Boolean);

      // 불굴(전체 대신맞기) 체크
      const tankAll = game.players.find((p) => p.tankingAll && !p.down);

      // 1단계: 각 대상별로 피해 정보 수집
      const damageInfos = [];
      
      for (const t of targets) {
        if (t.down) continue;

        const atk = effectiveStat(m, "atk");
        const roll = d6();
        const baseRaw = atk * roll;
        const raw = applyDebuffsToMonsterAttack(m, baseRaw);
        const atkFormula = `공격 ${atk}×${roll}(1d6)=${baseRaw}${
          raw !== baseRaw ? ` (참회 적용 후 ${raw})` : ""
        }`;

        // 1) 불굴 체크 (최우선)
        // 2) 수호 체크
        let isRedirected = false;
        let redirectReason = "";
        let tank = null;
        let defBonus = 0;
        
        if (tankAll && tankAll.id !== t.id) {
          // 불굴: 탱커가 모든 피해 대신 받음
          isRedirected = true;
          redirectReason = "불굴";
          tank = tankAll;
          defBonus = 0; // 불굴은 일반 방어 적용
        } else if (t.redirect && t.redirect.mode === "FULL") {
          tank = pickPlayerById(t.redirect.tankId);
          if (tank && !tank.down) {
            isRedirected = true;
            redirectReason = "수호";
            defBonus = t.redirect.defBonus ?? 0;
          }
        }

        damageInfos.push({
          originalTarget: t,
          tank,
          isRedirected,
          redirectReason,
          defBonus,
          raw,
          atkFormula
        });
      }

      // 2단계: 각 피해 처리 (불굴/수호 피해와 본인 피해 분리)
      const processedOwnDamage = new Set(); // 본인 피해로 처리된 대상
      let tankAllTotalDamage = 0; // 불굴 탱커가 받은 총 피해
      const tankAllSources = []; // 불굴로 대신 받은 피해 출처
      
      for (const info of damageInfos) {
        const { originalTarget, tank, isRedirected, redirectReason, defBonus, raw, atkFormula } = info;
        
        if (isRedirected && tank) {
          if (redirectReason === "불굴") {
            // 불굴: 나중에 합산해서 처리
            tankAllTotalDamage += raw;
            tankAllSources.push({ name: originalTarget.name, raw, atkFormula });
          } else {
            // 수호로 대신 받는 피해 - 수호 보너스만 적용
            const res = applyDamage(tank, raw, {
              ignoreDefense: true,
              allowFloor: tank.minHpFloor,
              defBonus,
            });

            let logMsg = `👹 ${m.name} → ${originalTarget.name} (광역공격, [스킬:수호] ${tank.name}이(가) 대신 받음)\n`;
            logMsg += `   [${atkFormula}]\n`;
            logMsg += `   [수호 방어 보너스 ${defBonus}]\n`;
            logMsg += `   → 데미지 ${raw}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
            log(logMsg);

            if (tank.endure) tank.endure.accum += res.dealt;
            setDownIfNeeded(tank);
          }
        } else {
          // 본인이 직접 받는 피해 - 일반 방어 적용 (중복 방지)
          if (processedOwnDamage.has(originalTarget.id)) {
            continue; // 이미 본인 피해로 처리됨
          }
          processedOwnDamage.add(originalTarget.id);
          
          const res = applyDamage(originalTarget, raw, {
            ignoreDefense: false,
            allowFloor: originalTarget.minHpFloor,
            defMult: 1.0,
          });

          let logMsg = `👹 ${m.name} → ${originalTarget.name} (광역공격)\n`;
          logMsg += `   [${atkFormula}]\n`;
          if (res.defFormula) logMsg += `   [${res.defFormula}]\n`;
          logMsg += `   → 데미지 ${raw}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
          log(logMsg);

          if (originalTarget.endure) originalTarget.endure.accum += res.dealt;
          setDownIfNeeded(originalTarget);
        }
      }
      
      // 3단계: 불굴 탱커 합산 피해 처리
      if (tankAll && tankAllTotalDamage > 0) {
        const res = applyDamage(tankAll, tankAllTotalDamage, {
          ignoreDefense: false,
          allowFloor: true, // 불굴은 HP 1 미만 불가
          defMult: 1.0,
        });

        const sourceList = tankAllSources.map(s => `${s.name}:${s.raw}`).join(" + ");
        let logMsg = `👹 ${m.name} → [스킬:불굴] ${tankAll.name}이(가) 광역 피해를 모두 대신 받음\n`;
        logMsg += `   [피해 합산: ${sourceList} = ${tankAllTotalDamage}]\n`;
        if (res.defFormula) logMsg += `   [${res.defFormula}]\n`;
        logMsg += `   → 데미지 ${tankAllTotalDamage}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
        log(logMsg);

        if (tankAll.endure) tankAll.endure.accum += res.dealt;
        // 불굴은 setDownIfNeeded 호출 안함 (HP 1 유지)
      }
      continue;
    }

    if (intent.type === "BLEED") {
      const targets = intent.targetIds
        .map((id) => game.players.find((p) => p.id === id))
        .filter(Boolean);

      // 불굴(전체 대신맞기) 체크
      const tankAll = game.players.find((p) => p.tankingAll && !p.down);

      for (const t of targets) {
        if (t.down) continue;

        // 1) 불굴이 활성화되어 있으면 탱커에게 DOT 적용
        let dotTarget = t;
        let redirected = false;
        let redirectReason = "";

        if (tankAll && tankAll.id !== t.id) {
          dotTarget = tankAll;
          redirected = true;
          redirectReason = "불굴";
        }
        // 2) 불굴이 없으면 수호 체크
        else if (t.redirect && t.redirect.mode === "FULL") {
          const tank = pickPlayerById(t.redirect.tankId);
          if (tank && !tank.down) {
            dotTarget = tank;
            redirected = true;
            redirectReason = "수호";
          }
        }

        const atk = effectiveStat(m, "atk");
        const roll = Math.floor(Math.random() * 2) + 1; // 1d2
        const dotValue = atk * roll;

        // DOT 등록 (3턴 - 첫 틱은 즉시 적용하므로 2턴 남음)
        addDot(dotTarget, {
          type: "BLEED",
          value: dotValue,
          turns: 2, // 첫 틱 즉시 적용, 나머지 2턴
          sourceId: m.id,
        });

        // 즉시 첫 번째 출혈 피해 적용
        const bleedRes = applyDamage(dotTarget, dotValue, {
          ignoreDefense: true,
          sourceText: "BLEED",
          allowFloor: dotTarget.tankingAll,
        });

        const atkFormula = `공격 ${atk}×${roll}(1d2)=${dotValue}`;
        if (redirected) {
          log(
            `🩸 ${m.name}의 출혈 공격 → ${t.name} ([스킬:${redirectReason}] ${dotTarget.name}이(가) 대신 받음)\n   [${atkFormula}] 즉시 출혈 피해 ${dotValue} (실제 ${bleedRes.dealt}) + 2턴 지속 (방어 무시)`
          );
        } else {
          log(
            `🩸 ${m.name}의 출혈 공격 → ${dotTarget.name}\n   [${atkFormula}] 즉시 출혈 피해 ${dotValue} (실제 ${bleedRes.dealt}) + 2턴 지속 (방어 무시)`
          );
        }
        
        // 인내 누적
        if (dotTarget.endure) {
          dotTarget.endure.accum += bleedRes.dealt;
          log(`   ↳ 인내 누적: +${bleedRes.dealt} (총 ${dotTarget.endure.accum})`);
        }
        
        if (!dotTarget.tankingAll) setDownIfNeeded(dotTarget);
      }
      continue;
    }
  }

  // tank passive ENDURE tick down & reflect if completed
  for (const p of game.players) {
    if (p.endure) {
      p.endure.turnsLeft -= 1;
      if (p.endure.turnsLeft <= 0) {
        // 다운된 캐릭터는 반사 실패
        if (p.down) {
          log(`🧱 ${p.name}의 [스킬:인내] 종료: 다운 상태로 반사 실패`);
          p.endure = null;
          p.hasAggro = false;
          continue;
        }
        
        const dmg = Math.floor(p.endure.accum * 0.5);
        const target = firstAliveMonster();
        if (target && dmg > 0) {
          const res = applyDamage(target, dmg, { ignoreDefense: true });
          log(
            `🧱 ${p.name}의 [스킬:인내]가 끝나고 데미지를 되돌립니다! 반사: ${target.name}\n   [누적 ${p.endure.accum}×0.5=${dmg}] 피해 ${dmg} (방어 무시, 실제 ${res.dealt})`
          );
        } else {
          log(`🧱 ${p.name}의 [스킬:인내] 종료: 반사 피해 없음`);
        }
        p.endure = null;
        p.hasAggro = false; // 어그로 제거
      }
    }
  }

  // fighting spirit - 방어 감소 지속시간 관리 (공격은 발동 시 1회만)
  for (const p of game.players) {
    if (p.fightingSpirit) {
      p.fightingSpirit.turnsLeft -= 1;

      if (p.fightingSpirit.turnsLeft <= 0) {
        log(`🔥 ${p.name}의 [스킬:투혼] 종료: DEF 원래대로 복구`);
        p.fightingSpirit = null;
      }
    }
  }
}

function dealMonsterDamage(
  monster,
  target,
  raw,
  { label = "", atkFormula = "" } = {}
) {
  // 1) 불굴(전체 대신맞기)
  const tankAll = game.players.find((p) => p.tankingAll && !p.down);
  if (tankAll) {
    const res = applyDamage(tankAll, raw, {
      ignoreDefense: false,
      allowFloor: tankAll.minHpFloor,
      defMult: 1.0,
    });

    let logMsg = `👹 ${monster.name} → ${tankAll.name} (${label}, 불굴 대신받음)\n`;
    if (atkFormula) logMsg += `   [${atkFormula}]\n`;
    if (res.defFormula) logMsg += `   [${res.defFormula}]\n`;
    logMsg += `   → 데미지 ${raw}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
    log(logMsg);

    if (tankAll.endure) tankAll.endure.accum += res.dealt;
    setDownIfNeeded(tankAll);
    return;
  }

  // 2) 수호(FULL redirect)
  if (
    target &&
    !target.down &&
    target.redirect &&
    target.redirect.mode === "FULL"
  ) {
    const tank = pickPlayerById(target.redirect.tankId);
    if (tank && !tank.down) {
      const defBonus = target.redirect.defBonus ?? 0;

      const res = applyDamage(tank, raw, {
        ignoreDefense: true, // 기본 방어 경감 제거
        allowFloor: tank.minHpFloor,
        defBonus, // ← 수호의 핵심: 방어 보너스만 적용
      });

      let logMsg = `👹 ${monster.name} → ${target.name} (${label}, [스킬:수호]를 사용한 ${tank.name}이(가) 데미지를 대신 받아냅니다!)\n`;
      if (atkFormula) logMsg += `   [${atkFormula}]\n`;
      logMsg += `   [수호 방어 보너스 ${defBonus}]\n`;
      logMsg += `   → 데미지 ${raw}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
      log(logMsg);

      if (tank.endure) tank.endure.accum += res.dealt;
      setDownIfNeeded(tank);
      return; // ★ 피해 대상자(target)는 여기서 아무 피해도 받지 않음
    }
    // 탱커가 없거나 다운이면 fallback으로 원래 대상이 맞음
  }

  // 3) 기본: 원래 대상이 맞음
  const res = applyDamage(target, raw, {
    ignoreDefense: false,
    allowFloor: target.minHpFloor,
    defMult: 1.0,
  });

  let logMsg = `👹 ${monster.name} → ${target.name} (${label})\n`;
  if (atkFormula) logMsg += `   [${atkFormula}]\n`;
  if (res.defFormula) logMsg += `   [${res.defFormula}]\n`;
  logMsg += `   → 데미지 ${raw}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
  log(logMsg);

  if (target.endure) target.endure.accum += res.dealt;
  setDownIfNeeded(target);
}

// 수호로 리다이렉트된 경우 전용 처리 함수
function dealMonsterDamageWithProtect(
  monster,
  originalTarget,
  tank,
  raw,
  defBonus,
  { label = "", atkFormula = "" } = {}
) {
  const res = applyDamage(tank, raw, {
    ignoreDefense: true, // 기본 방어 경감 제거
    allowFloor: tank.minHpFloor,
    defBonus, // 수호 방어 보너스만 적용
  });

  let logMsg = `👹 ${monster.name} → ${originalTarget.name} (${label}, [스킬:수호] ${tank.name}이(가) 대신 받음)\n`;
  if (atkFormula) logMsg += `   [${atkFormula}]\n`;
  logMsg += `   [수호 방어 보너스 ${defBonus}]\n`;
  logMsg += `   → 데미지 ${raw}, 실제 피해량 ${res.dealt} (보호막 흡수 ${res.absorbed}, 방어 경감치 ${res.mitigated})`;
  log(logMsg);

  if (tank.endure) tank.endure.accum += res.dealt;
  setDownIfNeeded(tank);
}

/* =========================
         Target helpers
      ========================= */
function pickPlayerById(id) {
  return game.players.find((p) => p.id === id);
}
function pickMonsterById(id) {
  return game.monsters.find((m) => m.id === id);
}
function firstAliveMonster() {
  return game.monsters.find((m) => m.alive);
}
function randomAlivePlayer() {
  const alive = game.players.filter((p) => !p.down);
  if (alive.length === 0) return null;
  return alive[Math.floor(Math.random() * alive.length)];
}

/* =========================
         Character Creation UI
      ========================= */
function populateSkillSelectors() {
  const roleSel = document.getElementById("pRole");
  const a1 = document.getElementById("pActive1");
  const a2 = document.getElementById("pActive2");
  const u = document.getElementById("pUlt");

  function fill() {
    const role = roleSel.value;
    a1.innerHTML = "";
    a2.innerHTML = "";
    u.innerHTML = "";

    for (const s of SKILLS[role].active) {
      const o1 = document.createElement("option");
      o1.value = s.key;
      o1.textContent = `${s.name} - ${s.desc}`;
      const o2 = o1.cloneNode(true);
      a1.appendChild(o1);
      a2.appendChild(o2);
    }
    for (const s of SKILLS[role].ult) {
      const ou = document.createElement("option");
      ou.value = s.key;
      ou.textContent = `${s.name} - ${s.desc}`;
      u.appendChild(ou);
    }
  }
  roleSel.addEventListener("change", fill);
  fill();
}

function updateSumHint() {
  const vit = +document.getElementById("pVit").value;
  const atk = +document.getElementById("pAtk").value;
  const def = +document.getElementById("pDef").value;
  const agi = +document.getElementById("pAgi").value;
  const sum = vit + atk + def + agi;
  const el = document.getElementById("sumHint");
  if (sum === 28) {
    el.textContent = `스탯 총합 ${sum} (OK)`;
    el.className = "ok";
  } else {
    el.textContent = `스탯 총합 ${sum} (패시브 포함 28)`;
    el.className = "warn";
  }
}

/* =========================
         Buff cleanup (ENCOURAGE & MADNESS)
         We used debuff markers ENCOURAGE_* and MADNESS_* to remove their stat bonus at end of round.
         This is handled by decayDebuffsEndRound, but we must also revert temp stat.
      ========================= */
const _oldDecay = decayDebuffsEndRound;
decayDebuffsEndRound = function () {
  // Before decrement removal, find expiring ENCOURAGE and MADNESS debuffs and revert
  for (const p of game.players) {
    for (const d of p.debuffs) {
      // 격려 종료 처리
      if (d.type.startsWith("ENCOURAGE_") && d.turns === 1) {
        const stat = d.type.replace("ENCOURAGE_", "").toLowerCase(); // atk/def/agi/vit
        const plusKey = stat + "Plus";
        p.temp[plusKey] = Math.max(0, (p.temp[plusKey] || 0) - d.value);
        log(
          `⏳ [스킬:격려]로 인한 버프가 종료되었습니다.: ${
            p.name
          } ${stat.toUpperCase()} -${d.value}`
        );
      }
      // 광기 종료 처리
      if (d.type === "MADNESS_ATK" && d.turns === 1) {
        p.temp.atkPlus = Math.max(0, (p.temp.atkPlus || 0) - d.value);
        log(
          `⏳ [스킬:광기]로 인한 버프가 종료되었습니다.: ${p.name} ATK -${d.value}`
        );
      }
    }
  }
  _oldDecay();
};

/* =========================
         Wire UI Events
      ========================= */
populateSkillSelectors();

["pVit", "pAtk", "pDef", "pAgi"].forEach((id) => {
  document.getElementById(id).addEventListener("input", updateSumHint);
});
updateSumHint();

document.getElementById("addPlayerBtn").addEventListener("click", () => {
  if (game.players.length >= 8) {
    log("⚠️ 플레이어는 최대 8명입니다.");
    return;
  }
  const name =
    (document.getElementById("pName").value || "").trim() ||
    `Player${game.players.length + 1}`;
  const role = document.getElementById("pRole").value;
  const vit = clamp(+document.getElementById("pVit").value, 1, 12);
  const atk = clamp(+document.getElementById("pAtk").value, 1, 12);
  const def = clamp(+document.getElementById("pDef").value, 1, 12);
  const agi = clamp(+document.getElementById("pAgi").value, 1, 12);

  const a1 = document.getElementById("pActive1").value;
  const a2 = document.getElementById("pActive2").value;
  const ult = document.getElementById("pUlt").value;

  if (a1 === a2) {
    log(
      "⚠️ 액티브 2개는 서로 다른 스킬을 선택하는 것을 권장합니다. (동일 선택도 일단 허용)"
    );
  }

  const p = makePlayer({
    name,
    role,
    vit,
    atk,
    def,
    agi,
    actives: [a1, a2],
    ult,
  });
  game.players.push(p);
  log(`+ 플레이어 추가: ${p.name} (${p.role}) HP ${p.maxHp}`);
  renderPlayerActionCards();
  renderStates();
});

document
  .getElementById("clearPlayersBtn")
  .addEventListener("click", () => {
    game.players = [];
    game.actions.clear();
    log("플레이어 초기화");
    renderPlayerActionCards();
    renderStates();
  });

document.getElementById("addMonsterBtn").addEventListener("click", () => {
  if (game.monsters.length >= 4) {
    log("⚠️ 몬스터는 최대 4마리입니다.");
    return;
  }
  const name =
    (document.getElementById("mName").value || "").trim() ||
    `MONSTER${game.monsters.length + 1}`;
  const hpBase = clamp(
    +document.getElementById("mHpBase").value,
    50,
    5000
  );
  const vit = clamp(+document.getElementById("mVit").value, 1, 20);
  const atk = clamp(+document.getElementById("mAtk").value, 1, 20);
  const def = clamp(+document.getElementById("mDef").value, 1, 20);
  const agi = clamp(+document.getElementById("mAgi").value, 1, 20);

  // 공격 패턴 비율 읽기
  const patSingle = Math.max(0, +document.getElementById("mPatSingle").value || 25);
  const patAoe = Math.max(0, +document.getElementById("mPatAoe").value || 25);
  const patBleed = Math.max(0, +document.getElementById("mPatBleed").value || 25);
  const patBuff = Math.max(0, +document.getElementById("mPatBuff").value || 25);
  
  const patterns = {
    single: patSingle,
    aoe: patAoe,
    bleed: patBleed,
    buff: patBuff
  };

  const m = makeMonster({ name, vit, atk, def, agi, hpBase, patterns });
  game.monsters.push(m);
  log(`+ 몬스터 추가: ${m.name} HP ${m.maxHp} | 패턴: 단일${patSingle}% 광역${patAoe}% 출혈${patBleed}% 버프${patBuff}%`);
  renderPlayerActionCards();
  renderStates();
});

document
  .getElementById("clearMonstersBtn")
  .addEventListener("click", () => {
    game.monsters = [];
    log("몬스터 초기화");
    renderPlayerActionCards();
    renderStates();
  });

document
  .getElementById("startRoundBtn")
  .addEventListener("click", startRound);
document
  .getElementById("resolveBtn")
  .addEventListener("click", resolveRound);
document.getElementById("undoBtn").addEventListener("click", undoRound);

document
  .getElementById("resetBattleBtn")
  .addEventListener("click", () => {
    game.round = 1;
    game.phase = "HINT";
    game.monsterIntents = null;
    game.actions.clear();
    gameSnapshot = null; // 스냅샷 초기화

    // reset hp and states
    for (const p of game.players) {
      p.hp = p.maxHp;
      p.down = false;
      p.downCounter = 0;
      p.ultUsed = false;
      p.lastActiveKey = null;
      p.shields = [];
      p.debuffs = [];
      p.dots = [];
      p.redirect = null;
      p.tankingAll = false;
      p.minHpFloor = false;
      p._defendBonus = 0;
      p.endure = null;
      p.fightingSpirit = null;
      p.pendingAtkPlusNext = 0;
      p.pendingEncourage = [];
      p.hasAggro = false; // 어그로 초기화
      p.temp = { atkPlus: 0, defPlus: 0, agiPlus: 0, vitPlus: 0 };
    }
    for (const m of game.monsters) {
      m.hp = m.maxHp;
      m.alive = true;
      m.debuffs = [];
      m.dots = [];
      m.shields = [];
      m.temp = { atkPlus: 0, defPlus: 0, agiPlus: 0, vitPlus: 0 };
    }

    log("\n=== 전투 리셋 ===");
    document.getElementById("hintBox").textContent =
      "라운드 시작 버튼을 눌러 암시를 생성하세요.";
    renderPlayerActionCards();
    renderStates();
  });

document.getElementById("autoFillBtn").addEventListener("click", () => {
  if (game.phase !== "PLAYER") {
    log("⚠️ 자동 입력은 PLAYER 단계에서만 가능합니다.");
    return;
  }
  const m = firstAliveMonster();
  for (const p of game.players) {
    if (p.down) continue;
    game.actions.set(p.id, {
      type: "ATTACK",
      skillKey: null,
      t1: m ? m.id : null,
      t2: null,
      stat: "atk",
    });
  }
  renderPlayerActionCards();
  log("자동 입력: 전원 기본 공격 처리");
});

document
  .getElementById("clearActionsBtn")
  .addEventListener("click", () => {
    game.actions.clear();
    renderPlayerActionCards();
    log("행동 초기화");
  });

document.getElementById("clearLogBtn").addEventListener("click", () => {
  game.logLines = [];
  document.getElementById("battleLog").innerHTML = "";
  renderStates();
});

document
  .getElementById("copyLogBtn")
  .addEventListener("click", async () => {
    const logCard = document.getElementById("battleLog").closest(".card");

    try {
      // 캡쳐 중 표시
      const btn = document.getElementById("copyLogBtn");
      const originalText = btn.textContent;
      btn.textContent = "캡쳐 중...";
      btn.disabled = true;

      // html2canvas로 로그 영역 캡쳐
      const canvas = await html2canvas(logCard, {
        backgroundColor: "#171724",
        scale: 2, // 고해상도
        logging: false,
        useCORS: true,
      });

      // 이미지로 다운로드
      const link = document.createElement("a");
      const timestamp = new Date()
        .toISOString()
        .slice(0, 19)
        .replace(/[T:]/g, "-");
      link.download = `battle-log-${timestamp}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      btn.textContent = originalText;
      btn.disabled = false;
      log("📷 로그 캡쳐 완료 - 이미지 다운로드됨");
    } catch (e) {
      log("⚠️ 로그 캡쳐 실패: " + e.message);
      const btn = document.getElementById("copyLogBtn");
      btn.textContent = "📷 로그 캡쳐";
      btn.disabled = false;
    }
  });

/* 왼쪽 패널 접기/펼치기 */
document
  .getElementById("collapseLeftBtn")
  .addEventListener("click", () => {
    const app = document.getElementById("mainApp");
    const leftPanel = document.getElementById("leftPanel");
    const btn = document.getElementById("collapseLeftBtn");

    if (leftPanel.classList.contains("collapsed")) {
      leftPanel.classList.remove("collapsed");
      app.classList.remove("left-collapsed");
      btn.textContent = "◀";
      btn.title = "패널 접기";
    } else {
      leftPanel.classList.add("collapsed");
      app.classList.add("left-collapsed");
      btn.textContent = "▶ 생성";
      btn.title = "패널 펼치기";
    }
  });

/* Initial render */
renderPlayerActionCards();
renderStates();
