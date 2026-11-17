/* Animações de combate e solicitação de ações validadas pelo servidor. */
'use strict';

  function startPunch() {
    if(!gameStarted || !screens.game.classList.contains('active') || punch.cooldown>0) return;
    const selectedItem=inventory[selectedInventorySlot];
    const selectableWeaponClasses=new Set(['melee','ranged','magic','tool']);
    const selectedWeapon=selectedItem&&!selectedItem.wearSlot&&selectableWeaponClasses.has(selectedItem.equipmentClass)
      &&selectedItem.itemType!=='ammo'?selectedItem:null;
    const magicLevel=window.KTKPlayerStats.stats.magicLevel.value;
    const innateMagic=magicLevel>=6&&!isMagicWeapon(selectedWeapon);
    const magicProfile=innateMagic?getInnateMagicProfile(magicLevel):null;
    let weapon=innateMagic?{
      id:'level-six-innate-magic',
      displayName:'Magia inata',
      equipmentClass:'magic',
      itemType:'equipment',
      ...magicProfile,
      durabilityUnit:'blocks',
      twoHanded:false
    }:selectedWeapon;
    // O servidor valida munição, mana e estamina na ação de ataque/projétil.
    const innateCast=innateMagic&&weapon?.id==='level-six-innate-magic';
    punch.active=true;
    punch.elapsed=0;
    punch.cooldown=weapon?.attackInterval>0?weapon.attackInterval:PUNCH_COOLDOWN_SECONDS;
    punch.direction=player.direction;
    punch.hitApplied=false;
    punch.weaponAttack=Boolean(weapon);
    punch.range=weapon?.range>0?weapon.range:PUNCH_RANGE;
    punch.attackBonus=Number(weapon?.attackBonus)||0;
    punch.damageMultiplier=innateCast?magicProfile.damageMultiplier:1;
    punch.weaponItem=weapon;

  }

  function updatePunch(deltaSeconds) {
    punch.cooldown=Math.max(0,punch.cooldown-deltaSeconds);
    if(!punch.active) return;
    punch.elapsed+=deltaSeconds;
    if(!punch.hitApplied && punch.elapsed>=PUNCH_IMPACT_SECONDS) {
      punch.hitApplied=true;
      if(punch.weaponAttack&&punch.weaponItem?.id==='equipment-boomerang') {
        launchBoomerang(punch.weaponItem,punch.direction);
      } else if(punch.weaponAttack&&isArrowWeapon(punch.weaponItem)) {
        launchArrowProjectile(punch.weaponItem,punch.direction);
      } else if(punch.weaponAttack&&punch.weaponItem?.id==='equipment-slingshot') {
        launchStoneProjectile(punch.weaponItem,punch.direction);
      } else if(punch.weaponAttack&&isMagicWeapon(punch.weaponItem)) {
        launchMagicProjectile(punch.weaponItem,punch.direction);
      } else {
        resolvePunchHit();
      }
    }
    if(punch.elapsed>=PUNCH_ANIMATION_SECONDS) punch.active=false;
  }

  function resolvePunchHit() {
    // O servidor escolhe o alvo real pela posição oficial dos jogadores e inimigos.
    applyCombatHit(player,null,punch.direction);
  }

  function isArrowWeapon(item) {
    return item?.id==='equipment-crossbow'||/^equipment-bow-(normal|great|recurve)(-|$)/.test(item?.id||'');
  }

  function isMagicWeapon(item) {
    return Boolean(item&&item.equipmentClass==='magic'&&item.itemType!=='ammo');
  }

  function isArrowAmmo(item) {
    return Boolean(item&&(item.ammoKey==='arrow'||item.id==='equipment-arrow'||item.id==='equipment-arrow-2'));
  }

  function getArrowAmmoStack() {
    return inventory.find(isArrowAmmo)||null;
  }

  function requestServerProjectile(item,direction) {
    void window.KTKOnline?.gameAction?.('launch_projectile',{
      weapon_id:String(item?.id||''),
      direction:Number(direction)
    }).catch(error=>toast(error?.message||'O servidor recusou o disparo.'));
  }

  function launchArrowProjectile(item,direction) {
    requestServerProjectile(item,direction);
  }

  function launchStoneProjectile(item,direction) {
    requestServerProjectile(item,direction);
  }

  function launchMagicProjectile(item,direction) {
    requestServerProjectile(item,direction);
  }

  function launchBoomerang(item,direction) {
    requestServerProjectile(item,direction);
  }

  function getEntityWorldPosition(entity) {
    if(entity===player) {
      return {
        x:camera.x*canvas.clientWidth+player.x,
        y:camera.y*canvas.clientHeight+player.y
      };
    }
    if(entity?.type==='player'&&entity.id) {
      return {x:Number.isFinite(entity.targetX)?entity.targetX:entity.x,
        y:Number.isFinite(entity.targetY)?entity.targetY:entity.y};
    }
    return {x:entity.x,y:entity.y};
  }

  function getEffectiveEntityStats(entity, attackBonusOverride) {
    if(entity===player) return window.KTKPlayerStats.getEffectiveCombatStats(attackBonusOverride);
    if(entity?.type==='player'&&entity.id) {
      const stats=entity.combatStats||{};
      return {
        attack:Number.isFinite(Number(stats.attack))?Number(stats.attack):10,
        defense:Number.isFinite(Number(stats.defense))?Number(stats.defense):10,
        multiplier:1
      };
    }
    const condition=(
      entity.health/entity.maxHealth+
      entity.satiety/entity.maxSatiety+
      entity.hydration/entity.maxHydration+
      entity.stamina/entity.maxStamina
    )/4;
    const multiplier=Math.max(0,Math.min(2,condition*2));
    return {
      attack:Math.round(entity.attack*multiplier),
      defense:Math.round(entity.defense*multiplier),
      multiplier
    };
  }

  function refreshSkeletonCombatStats() {
    const skeleton=window.KTKEnemySkeleton.entity;
    const healthValue=document.getElementById('skeleton-health-value');
    const healthFill=document.getElementById('skeleton-health-fill');
    if(healthValue) healthValue.textContent=skeleton.health;
    if(healthFill) healthFill.style.width=`${Math.max(0,skeleton.health/skeleton.maxHealth*100)}%`;
    const combat=getEffectiveEntityStats(skeleton);
    const attackValue=document.getElementById('skeleton-attack-value');
    const defenseValue=document.getElementById('skeleton-defense-value');
    if(attackValue) attackValue.textContent=combat.attack;
    if(defenseValue) defenseValue.textContent=combat.defense;
  }

  function applyCombatHit(attacker,target,direction,confirmedProjectileContact=false,weaponItemOverride=null) {
    if(attacker!==player || !gameStarted || !Number.isInteger(Number(direction))) return false;
    const weapon=weaponItemOverride||punch.weaponItem;
    void window.KTKOnline?.gameAction?.('attack',{
      direction:Number(direction),
      weapon_id:weapon?.id||null
    }).then(result=>{
      if(!result?.ok) return;
      if(result.target_dead && result.target_type==='enemy') toast('Esqueleto derrotado.');
      if(result.hit && result.target_type==='enemy') {
        const enemy=window.KTKEnemySkeleton.entity;
        startKnockback(enemy,{x:[0,-1,0,1][Number(direction)],y:[-1,0,1,0][Number(direction)]});
        if(enemy.knockback) enemy.knockback.authoritative=true;
      }
      if(result.state) applyServerState(result.state);
    }).catch(error=>toast(error?.message||'O servidor recusou o ataque.'));
    return true;
  }

  function startKnockback(target,vector) {
    target.knockback={x:vector.x,y:vector.y,progress:0};
  }

  function updateKnockbacks(deltaSeconds) {
    // Knockback aqui é apenas animação de elevação/sombra.
    // Nem mesmo entidades remotas recebem deslocamento calculado no navegador.
    [player,window.KTKEnemySkeleton.entity].forEach(target=>{
      const knockback=target.knockback;
      if(!knockback) return;
      knockback.progress=Math.min(1,knockback.progress+deltaSeconds/KNOCKBACK_SECONDS);
      target.knockbackHeight=Math.sin(knockback.progress*Math.PI)*KNOCKBACK_HEIGHT;
      if(knockback.progress>=1) {
        target.knockback=null;
        target.knockbackHeight=0;
      }
    });
  }

  function directionToward(dx,dy) {
    if(Math.abs(dx)>Math.abs(dy)) return dx<0?1:3;
    return dy<0?0:2;
  }

  function updateEnemyCombat() {
    // A IA, o deslocamento e os ataques do esqueleto pertencem ao servidor.
  }

  function getEquipmentAttributeDetails(item) {
    const format=value=>Number(value).toLocaleString('pt-BR',{maximumFractionDigits:2});
    const details=[];
    const displayName=String(item.displayName||'').toLowerCase();
    const materialName=String(item.materialName||'');
    if(materialName&&!displayName.startsWith(`${materialName.toLowerCase()} `)) details.push(`Material ${materialName}`);
    if(item.twoHanded) details.push('Duas mãos');
    if(item.attackBonus>0) details.push(`Ataque +${format(item.attackBonus)}`);
    if(item.range>0) details.push(`Alcance ${format(item.range)}`);
    if(item.staminaCost>0) details.push(`Estamina ${format(item.staminaCost)}`);
    if(item.attackInterval>0) details.push(`Intervalo ${format(item.attackInterval)} s`);
    if(item.defenseBonus>0) details.push(`Defesa +${format(item.defenseBonus)} ao bloquear`);
    if(item.wearSlot) details.push(`Espaco ${wearableSlotLabel(item.wearSlot)}`);
    if(item.wearCategory==='armor'&&item.armorDefense>0) details.push(`Defesa +${format(item.armorDefense)}`);
    if(item.wearCategory==='cosmetic') details.push('Cosmetico, sem bonus de atributos');
    if(item.speedPenalty>0) details.push(`Velocidade -${format(item.speedPenalty)}`);
    if(item.blockStaminaCost>0) details.push(`Estamina por bloqueio ${format(item.blockStaminaCost)}`);
    if(item.projectileSpeed>0) details.push(`Velocidade do projetil ${format(item.projectileSpeed)}`);
    if(item.manaCost>0) details.push(`Mana ${format(item.manaCost)}`);
    if(item.castTime>0) details.push(`Conjuracao ${format(item.castTime)} s`);
    if(item.ammoPerAttack>0) details.push(`Consome ${item.ammoPerAttack} por disparo`);
    if(item.quantity!=null) details.push(`Quantidade ${item.quantity}`);
    if(item.durability>0) details.push(`Durabilidade ${item.durability}/${item.maxDurability} ${item.durabilityUnit}`);
    if(item.equipmentClass==='tool'&&item.workEfficiency>0) details.push(`Trabalho x${format(item.workEfficiency)}`);
    Object.entries(item.materialDamageBonuses||{}).forEach(([type,multiplier])=>{
      if(Number(multiplier)>1) details.push(`+${format((Number(multiplier)-1)*100)}% contra ${type==='undead'?'mortos-vivos':type}`);
    });
    return details;
  }

  function wearableSlotLabel(slot) {
    return ({head:'cabeca',chest:'peito',waist:'costas',legs:'pernas',feet:'pes'})[slot]||slot;
  }

  function describeEquipment(item) {
    return [item.displayName||'Item',item.category,...getEquipmentAttributeDetails(item)].filter(Boolean).join(' | ');
  }
