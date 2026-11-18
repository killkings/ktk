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
    speed:       { value: 2, min: 1, max: 4.5 }
  };
  const initialValues = Object.fromEntries(Object.entries(stats).map(([name, stat]) => [name, stat.value]));
  const changeListeners = new Set();

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  let getEquipmentAttackBonus = () => 0;
  let getEquipmentDefenseMultiplier = () => 1;
  let getEquipmentArmorDefense = () => 0;
  let getEquipmentSpeedPenalty = () => 0;

  // O modelo publica mudanças sem conhecer DOM, seletores ou elementos HTML.
  function notifyChange() {
    changeListeners.forEach(listener => {
      try {
        listener(stats);
      } catch (error) {
        console.error('Erro ao atualizar a interface de atributos:', error);
      }
    });
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    changeListeners.add(listener);
    return () => changeListeners.delete(listener);
  }

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
    notifyChange();
  }

  function setEquipmentDefenseMultiplierProvider(provider) {
    getEquipmentDefenseMultiplier = typeof provider === 'function' ? provider : () => 1;
    notifyChange();
  }

  function setEquipmentArmorDefenseProvider(provider) {
    getEquipmentArmorDefense = typeof provider === 'function' ? provider : () => 0;
    notifyChange();
  }

  function setEquipmentSpeedPenaltyProvider(provider) {
    getEquipmentSpeedPenalty = typeof provider === 'function' ? provider : () => 0;
    notifyChange();
  }

  function resetForNewCharacter() {
    Object.entries(stats).forEach(([name, stat]) => { stat.value = initialValues[name]; });
    notifyChange();
  }

  function updateStamina(deltaSeconds, moving, runRequested, defending, speedMultiplier = 1) {
    // Os valores são replicados pelo Supabase; este método só calcula a animação/velocidade visual.
    const hasStamina = stats.stamina.value > 0;
    const running = Boolean(moving && runRequested && hasStamina);
    const shielding = Boolean(defending && hasStamina);
    const baseSpeed = running ? 3 : 2;
    const shieldSpeed = shielding ? baseSpeed * 0.5 : baseSpeed;
    const equipmentAdjustedSpeed = clamp(
      shieldSpeed - Math.max(0, Number(getEquipmentSpeedPenalty()) || 0),
      stats.speed.min,
      3
    );
    const terrainMultiplier = Math.max(1, Number(speedMultiplier) || 1);
    stats.speed.value = Math.min(stats.speed.max, equipmentAdjustedSpeed * terrainMultiplier);
    notifyChange();
    return { running, speed: stats.speed.value, shielding, stamina: stats.stamina.value };
  }
  function updateMana() {
    // Regeneração e limites de mana pertencem à simulação do banco.
  }

  function cycleMagicLevel() {
    // Mantido apenas por compatibilidade; a mudança real vem de ktk_game_action.
    return stats.magicLevel.value;
  }

  function consumeStamina() {
    // O servidor cobra o custo na ação validada.
    return stats.stamina.value > 0;
  }

  function canConsumeMana(amount) {
    const cost = Math.max(0, Number(amount) || 0);
    return stats.magicLevel.value > 0 && stats.mana.value >= cost;
  }

  function consumeMana() {
    // O servidor desconta a mana quando confirma o ataque mágico.
    return stats.mana.value > 0;
  }

  window.KTKPlayerStats = {
    stats,
    updateStamina,
    updateMana,
    cycleMagicLevel,
    consumeStamina,
    canConsumeMana,
    consumeMana,
    getEffectiveCombatStats,
    setEquipmentAttackBonusProvider,
    setEquipmentDefenseMultiplierProvider,
    setEquipmentArmorDefenseProvider,
    setEquipmentSpeedPenaltyProvider,
    resetForNewCharacter,
    subscribe,
    // Compatibilidade: chamadas antigas de render() agora notificam a interface inscrita.
    render: notifyChange
  };
})();
