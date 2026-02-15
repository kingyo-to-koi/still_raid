/* =========================
   Admin Panel Functions
   ========================= */

// 관리자 패널 토글
function toggleAdminPanel() {
  const panel = document.getElementById("adminPanelContent");
  const btn = document.getElementById("adminToggleBtn");
  if (panel.classList.contains("admin-hidden")) {
    panel.classList.remove("admin-hidden");
    btn.textContent = "🔒 관리자 패널 닫기";
    refreshAdminSelects();
  } else {
    panel.classList.add("admin-hidden");
    btn.textContent = "🔧 관리자 패널 열기";
  }
}

// 관리자 패널 셀렉트 박스 갱신
function refreshAdminSelects() {
  // 플레이어 셀렉트
  const playerSelects = document.querySelectorAll(".admin-player-select");
  playerSelects.forEach((sel) => {
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- 선택 --</option>';
    game.players.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name} (${ROLE_LABEL[p.role]})${p.down ? " [DOWN]" : ""}`;
      sel.appendChild(opt);
    });
    if (currentVal && game.players.find((p) => p.id === currentVal)) {
      sel.value = currentVal;
    }
  });

  // 몬스터 셀렉트
  const monsterSelects = document.querySelectorAll(".admin-monster-select");
  monsterSelects.forEach((sel) => {
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">-- 선택 --</option>';
    game.monsters.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.name}${!m.alive ? " [DEAD]" : ""}`;
      sel.appendChild(opt);
    });
    if (currentVal && game.monsters.find((m) => m.id === currentVal)) {
      sel.value = currentVal;
    }
  });
  
  // 피해/회복 대상 셀렉트 초기화
  adminDamageTargetTypeChanged();
}

// ========== 플레이어 HP 설정 ==========
function adminSetPlayerHp() {
  const playerId = document.getElementById("adminPlayerHpSelect").value;
  const newHp = parseInt(document.getElementById("adminPlayerHpInput").value);

  if (!playerId) {
    alert("플레이어를 선택하세요.");
    return;
  }
  if (isNaN(newHp) || newHp < 0) {
    alert("유효한 HP 값을 입력하세요.");
    return;
  }

  const player = game.players.find((p) => p.id === playerId);
  if (!player) return;

  const oldHp = player.hp;
  player.hp = Math.min(newHp, player.maxHp);
  
  // 다운 상태 체크
  if (player.hp <= 0 && !player.down) {
    player.down = true;
    player.hp = 0;
  } else if (player.hp > 0 && player.down) {
    player.down = false;
    player.downCounter = 0;
  }

  log(`🔧 [GM] ${player.name}의 HP 변경: ${oldHp} → ${player.hp}`);
  renderStates();
  refreshAdminSelects();
}

// ========== 플레이어 다운/부활 토글 ==========
function adminTogglePlayerDown() {
  const playerId = document.getElementById("adminPlayerDownSelect").value;

  if (!playerId) {
    alert("플레이어를 선택하세요.");
    return;
  }

  const player = game.players.find((p) => p.id === playerId);
  if (!player) return;

  if (player.down) {
    // 부활
    player.down = false;
    player.downCounter = 0;
    player.hp = Math.max(1, Math.floor(player.maxHp * 0.5)); // 50% HP로 부활
    log(`🔧 [GM] ${player.name} 강제 부활! (HP ${player.hp})`);
  } else {
    // 다운
    player.down = true;
    player.hp = 0;
    log(`🔧 [GM] ${player.name} 강제 다운!`);
  }

  renderStates();
  refreshAdminSelects();
}

// ========== 플레이어 스탯 임시 조정 ==========
function adminAdjustPlayerStat() {
  const playerId = document.getElementById("adminPlayerStatSelect").value;
  const stat = document.getElementById("adminStatType").value;
  const delta = parseInt(document.getElementById("adminStatDelta").value);

  if (!playerId) {
    alert("플레이어를 선택하세요.");
    return;
  }
  if (isNaN(delta)) {
    alert("유효한 값을 입력하세요.");
    return;
  }

  const player = game.players.find((p) => p.id === playerId);
  if (!player) return;

  const plusKey = stat + "Plus";
  const oldVal = player.temp[plusKey] || 0;
  player.temp[plusKey] = oldVal + delta;

  const sign = delta >= 0 ? "+" : "";
  log(`🔧 [GM] ${player.name}의 ${stat.toUpperCase()} 임시 조정: ${sign}${delta} (현재 보정: ${player.temp[plusKey]})`);
  renderStates();
}

// ========== 플레이어 상태 초기화 ==========
function adminResetPlayerStatus() {
  const playerId = document.getElementById("adminPlayerResetSelect").value;

  if (!playerId) {
    alert("플레이어를 선택하세요.");
    return;
  }

  const player = game.players.find((p) => p.id === playerId);
  if (!player) return;

  // 모든 상태 초기화
  player.debuffs = [];
  player.dots = [];
  player.shields = [];
  player.redirect = null;
  player.tankingAll = false;
  player.endure = null;
  player.fightingSpirit = null;
  player.temp = { atkPlus: 0, defPlus: 0, agiPlus: 0, vitPlus: 0 };
  player.pendingEncourage = [];
  player.hasAggro = false;

  log(`🔧 [GM] ${player.name}의 모든 상태 효과 초기화됨 (디버프/DOT/보호막/수호/버프)`);
  renderStates();
}

// ========== 몬스터 HP 설정 ==========
function adminSetMonsterHp() {
  const monsterId = document.getElementById("adminMonsterHpSelect").value;
  const newHp = parseInt(document.getElementById("adminMonsterHpInput").value);

  if (!monsterId) {
    alert("몬스터를 선택하세요.");
    return;
  }
  if (isNaN(newHp) || newHp < 0) {
    alert("유효한 HP 값을 입력하세요.");
    return;
  }

  const monster = game.monsters.find((m) => m.id === monsterId);
  if (!monster) return;

  const oldHp = monster.hp;
  monster.hp = Math.min(newHp, monster.maxHp);
  
  // 생존 상태 체크
  if (monster.hp <= 0) {
    monster.alive = false;
    monster.hp = 0;
  } else if (!monster.alive) {
    monster.alive = true;
  }

  log(`🔧 [GM] ${monster.name}의 HP 변경: ${oldHp} → ${monster.hp}`);
  renderStates();
  refreshAdminSelects();
}

// ========== 몬스터 스탯 조정 ==========
function adminAdjustMonsterStat() {
  const monsterId = document.getElementById("adminMonsterStatSelect").value;
  const stat = document.getElementById("adminMonsterStatType").value;
  const delta = parseInt(document.getElementById("adminMonsterStatDelta").value);

  if (!monsterId) {
    alert("몬스터를 선택하세요.");
    return;
  }
  if (isNaN(delta)) {
    alert("유효한 값을 입력하세요.");
    return;
  }

  const monster = game.monsters.find((m) => m.id === monsterId);
  if (!monster) return;

  const plusKey = stat + "Plus";
  if (!monster.temp) {
    monster.temp = { atkPlus: 0, defPlus: 0, agiPlus: 0, vitPlus: 0 };
  }
  const oldVal = monster.temp[plusKey] || 0;
  monster.temp[plusKey] = oldVal + delta;

  const sign = delta >= 0 ? "+" : "";
  log(`🔧 [GM] ${monster.name}의 ${stat.toUpperCase()} 임시 조정: ${sign}${delta} (현재 보정: ${monster.temp[plusKey]})`);
  renderStates();
}

// ========== 수동 로그 추가 ==========
function adminAddLog() {
  const message = document.getElementById("adminLogInput").value.trim();
  
  if (!message) {
    alert("로그 메시지를 입력하세요.");
    return;
  }

  log(`📝 [GM] ${message}`);
  document.getElementById("adminLogInput").value = "";
}

// ========== 피해/회복 직접 적용 ==========
function adminApplyDamage() {
  const targetType = document.getElementById("adminDamageTargetType").value;
  const targetId = document.getElementById("adminDamageTargetSelect").value;
  const amount = parseInt(document.getElementById("adminDamageAmount").value);

  if (!targetId) {
    alert("대상을 선택하세요.");
    return;
  }
  if (isNaN(amount) || amount === 0) {
    alert("유효한 값을 입력하세요 (양수=피해, 음수=회복).");
    return;
  }

  let target;
  if (targetType === "player") {
    target = game.players.find((p) => p.id === targetId);
  } else {
    target = game.monsters.find((m) => m.id === targetId);
  }

  if (!target) return;

  const oldHp = target.hp;
  
  if (amount > 0) {
    // 피해
    target.hp = Math.max(0, target.hp - amount);
    
    if (target.type === "PLAYER" && target.hp <= 0 && !target.down) {
      target.down = true;
      target.hp = 0;
    } else if (target.type === "MONSTER" && target.hp <= 0) {
      target.alive = false;
      target.hp = 0;
    }
    
    log(`🔧 [GM] ${target.name}에게 ${amount} 피해 적용 (HP: ${oldHp} → ${target.hp})`);
  } else {
    // 회복
    const healAmount = Math.abs(amount);
    target.hp = Math.min(target.maxHp, target.hp + healAmount);
    
    // 다운 상태에서 회복 시
    if (target.type === "PLAYER" && target.down && target.hp > 0) {
      target.down = false;
      target.downCounter = 0;
    } else if (target.type === "MONSTER" && !target.alive && target.hp > 0) {
      target.alive = true;
    }
    
    log(`🔧 [GM] ${target.name}에게 ${healAmount} 회복 적용 (HP: ${oldHp} → ${target.hp})`);
  }

  renderStates();
  refreshAdminSelects();
}

// 대상 타입 변경 시 셀렉트 갱신
function adminDamageTargetTypeChanged() {
  const targetType = document.getElementById("adminDamageTargetType").value;
  const sel = document.getElementById("adminDamageTargetSelect");
  
  sel.innerHTML = '<option value="">-- 선택 --</option>';
  
  if (targetType === "player") {
    game.players.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = `${p.name}${p.down ? " [DOWN]" : ""}`;
      sel.appendChild(opt);
    });
  } else {
    game.monsters.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = `${m.name}${!m.alive ? " [DEAD]" : ""}`;
      sel.appendChild(opt);
    });
  }
}

// 이벤트 리스너 등록 (DOM 로드 후)
document.addEventListener("DOMContentLoaded", function () {
  document.getElementById("adminToggleBtn")?.addEventListener("click", toggleAdminPanel);
  document.getElementById("adminSetPlayerHpBtn")?.addEventListener("click", adminSetPlayerHp);
  document.getElementById("adminToggleDownBtn")?.addEventListener("click", adminTogglePlayerDown);
  document.getElementById("adminAdjustStatBtn")?.addEventListener("click", adminAdjustPlayerStat);
  document.getElementById("adminResetStatusBtn")?.addEventListener("click", adminResetPlayerStatus);
  document.getElementById("adminSetMonsterHpBtn")?.addEventListener("click", adminSetMonsterHp);
  document.getElementById("adminAdjustMonsterStatBtn")?.addEventListener("click", adminAdjustMonsterStat);
  document.getElementById("adminAddLogBtn")?.addEventListener("click", adminAddLog);
  document.getElementById("adminLogInput")?.addEventListener("keypress", function(e) {
    if (e.key === "Enter") adminAddLog();
  });
  document.getElementById("adminApplyDamageBtn")?.addEventListener("click", adminApplyDamage);
  document.getElementById("adminDamageTargetType")?.addEventListener("change", adminDamageTargetTypeChanged);
});
