(() => {
  'use strict';

  const playerStats = window.KTKPlayerStats;
  if (!playerStats) {
    console.error('KTKPlayerStats precisa ser carregado antes de KTKPlayerStatsUI.');
    return;
  }

  const valueNodes = new Map(
    Array.from(document.querySelectorAll('[data-stat]'), node => [node.dataset.stat, node])
  );
  const meterNodes = new Map(
    Array.from(document.querySelectorAll('[data-meter]'), node => [node.dataset.meter, node])
  );

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function render() {
    const combat = playerStats.getEffectiveCombatStats();
    const magicLevel = Number(playerStats.stats.magicLevel?.value);
    const manaRow = valueNodes.get('magicLevel')?.closest('.stat-row');
    // visibility:hidden mantém a linha reservada no layout enquanto o nível mágico é zero.
    manaRow?.classList.toggle('mana-hidden', magicLevel === 0);
    for (const [name, stat] of Object.entries(playerStats.stats)) {
      const value = valueNodes.get(name);
      const shownValue = name === 'attack'
        ? combat.attack
        : name === 'defense'
          ? combat.defense
          : name === 'magicLevel'
            ? `${stat.value}/${stat.max}`
            : stat.value;

      if (value) {
        const formatted = typeof shownValue === 'number' && !Number.isInteger(shownValue)
          ? shownValue.toFixed(1)
          : shownValue;
        value.textContent = `${formatted}${stat.unit || ''}`;
      }

      const meter = meterNodes.get(name);
      if (meter) {
        const percent = name === 'temperature'
          ? 50
          : ((stat.value - stat.min) / (stat.max - stat.min)) * 100;
        meter.style.setProperty('--fill', `${clamp(percent, 0, 100)}%`);
      }
    }
  }

  playerStats.subscribe(render);
  render();
  window.KTKPlayerStatsUI = { render };
})();
