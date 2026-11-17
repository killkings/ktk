(() => {
  'use strict';

  const stats = {
    health:      { value: 50, min: 0, max: 99, recoveryMax: 50, recoveryRate: 0.5 },
    satiety:     { value: 99, min: 0, max: 99 },
    hydration:   { value: 99, min: 0, max: 99 },
    stamina:     { value: 50, min: 0, max: 99, recoveryMax: 50 },
    temperature: { value: 36.5, min: 35, max: 38, unit: ' °C' },
    mana:        { value: 0, min: 0, max: 99, recoveryRate: 1 },
    magicLevel:  { value: 0, min: 0, max: 10 },
    attack:      { value: 10, min: 0, max: 99 },
    defense:     { value: 10, min: 0, max: 99 },
    speed:       { value: 2, min: 1, max: 3 }
  };
  const initialValues = Object.fromEntries(Object.entries(stats).map(([name, stat]) => [name, stat.value]));

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let getEquipmentAttackBonus = () => 0;
  let getEquipmentDefenseMultiplier = () => 1;
  let getEquipmentArmorDefense = () => 0;
  let getEquipmentSpeedPenalty = () => 0;

  function getEffectiveCombatStats(attackBonusOverride) {
    const resources = ['health', 'satiety', 'hydration', 'stamina'];
    const condition = resources.reduce((sum, name) => {
      const resource = stats[name];
      return sum + clamp(resource.value / resource.max, 0, 1);
    }, 0) / resources.length;
    const multiplier = condition * 2;
    const attackBonus = attackBonusOverride === undefined
      ? Math.max(0, Number(getEquipmentAttackBonus()) || 0)
      : Math.max(0, Number(attackBonusOverride) || 0);
    const armorDefense = Math.max(0, Number(getEquipmentArmorDefense()) || 0);
    return {
      attack: Math.round(stats.attack.value * multiplier) + Math.round(attackBonus * multiplier),
      defense: Math.round(stats.defense.value * multiplier * Math.max(1, Number(getEquipmentDefenseMultiplier()) || 1)) + Math.round(armorDefense),
      multiplier
    };
  }

  function setEquipmentAttackBonusProvider(provider) {
    getEquipmentAttackBonus = typeof provider === 'function' ? provider : () => 0;
    render();
  }

  function setEquipmentDefenseMultiplierProvider(provider) {
    getEquipmentDefenseMultiplier = typeof provider === 'function' ? provider : () => 1;
    render();
  }

  function setEquipmentArmorDefenseProvider(provider) {
    getEquipmentArmorDefense = typeof provider === 'function' ? provider : () => 0;
    render();
  }

  function setEquipmentSpeedPenaltyProvider(provider) {
    getEquipmentSpeedPenalty = typeof provider === 'function' ? provider : () => 0;
    render();
  }

  function render() {
    const combat = getEffectiveCombatStats();
    for (const [name, stat] of Object.entries(stats)) {
      const value = document.querySelector(`[data-stat="${name}"]`);
      const shownValue = name === 'attack' ? combat.attack : name === 'defense' ? combat.defense : name === 'magicLevel' ? `${stat.value}/${stat.max}` : stat.value;
      if (value) value.textContent = `${typeof shownValue === 'number'&&!Number.isInteger(shownValue) ? shownValue.toFixed(1) : shownValue}${stat.unit || ''}`;
      const meter = document.querySelector(`[data-meter="${name}"]`);
      if (meter) {
        const percent = name === 'temperature' ? 50 : ((stat.value - stat.min) / (stat.max - stat.min)) * 100;
        meter.style.setProperty('--fill', `${clamp(percent, 0, 100)}%`);
      }
    }
  }

  function resetForNewCharacter() {
    Object.entries(stats).forEach(([name, stat]) => { stat.value = initialValues[name]; });
    render();
  }

  function updateStamina(deltaSeconds, moving, runRequested, defending) {
    const stamina = stats.stamina;
    const health = stats.health;
    const running = Boolean(moving && runRequested && stamina.value > 0);
    const shielding = Boolean(defending && stamina.value > 0);
    // Custos e recuperação são taxas por segundo para permanecerem estáveis em diferentes taxas de quadros.
    if (shielding) {
      const baseDrain = moving ? (running ? 2 : 1) : 1;
      stamina.value = clamp(stamina.value - deltaSeconds * baseDrain * 2, 0, stamina.max);
    }
    else if (moving) stamina.value = clamp(stamina.value - deltaSeconds * (running ? 2 : 1), 0, stamina.max);
    else if (stamina.value < stamina.recoveryMax) {
      stamina.value = clamp(stamina.value + deltaSeconds, stamina.min, stamina.recoveryMax);
    }
    if (!moving && stamina.value >= 50 && health.value >= 10 && health.value < health.recoveryMax) {
      health.value = clamp(health.value + deltaSeconds * health.recoveryRate, health.min, health.recoveryMax);
    }
    const baseSpeed = running ? 3 : 2;
    const shieldSpeed = shielding && stamina.value > 0 ? baseSpeed * 0.5 : baseSpeed;
    stats.speed.value = clamp(shieldSpeed - Math.max(0, Number(getEquipmentSpeedPenalty()) || 0), stats.speed.min, stats.speed.max);
    render();
    return { running, speed: stats.speed.value, shielding: shielding && stamina.value > 0, stamina: stamina.value };
  }

  function updateMana(deltaSeconds, moving, hasEquippedMagicWeapon, hasMagicWeaponInInventory) {
    const { mana, magicLevel, health, stamina } = stats;
    const level = magicLevel.value;
    if (level === 0) {
      if (mana.value !== 0) {
        mana.value = 0;
        render();
      }
      return;
    }
    const manaCap = Math.min(50, level * 10);
    if (moving || mana.value >= manaCap) return;
    if (level === 1 && (!hasEquippedMagicWeapon || health.value < 50 || stamina.value < 50)) return;
    if (level === 2 && (!hasMagicWeaponInInventory || health.value < 50 || stamina.value < 50)) return;
    if (level === 3 && stamina.value < 50) return;
    const recoveryMultiplier = level >= 8 ? 2 : 1;
    mana.value = clamp(mana.value + Math.max(0, deltaSeconds) * mana.recoveryRate * recoveryMultiplier, mana.min, manaCap);
    render();
  }

  function cycleMagicLevel() {
    const magicLevel = stats.magicLevel;
    magicLevel.value = (magicLevel.value + 1) % (magicLevel.max + 1);
    if (magicLevel.value === 0) stats.mana.value = 0;
    render();
    return magicLevel.value;
  }

  function consumeStamina(amount) {
    const stamina = stats.stamina;
    const cost = Math.max(0, Number(amount) || 0);
    if (stamina.value < cost) return false;
    stamina.value = clamp(stamina.value - cost, stamina.min, stamina.max);
    render();
    return true;
  }

  function canConsumeMana(amount) {
    const cost = Math.max(0, Number(amount) || 0);
    return stats.magicLevel.value > 0 && stats.mana.value >= cost;
  }

  function consumeMana(amount) {
    const mana = stats.mana;
    const cost = Math.max(0, Number(amount) || 0);
    if (stats.magicLevel.value === 0 || mana.value < cost) return false;
    mana.value = clamp(mana.value - cost, mana.min, mana.max);
    render();
    return true;
  }

  render();
  window.KTKPlayerStats = { stats, updateStamina, updateMana, cycleMagicLevel, consumeStamina, canConsumeMana, consumeMana, getEffectiveCombatStats, setEquipmentAttackBonusProvider, setEquipmentDefenseMultiplierProvider, setEquipmentArmorDefenseProvider, setEquipmentSpeedPenaltyProvider, resetForNewCharacter, render };
})();
