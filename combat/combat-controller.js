/* Animações de combate e solicitação de ações validadas pelo servidor. */
'use strict';

  function startPunch(event=null) {
    if(!gameStarted || !screens.game.classList.contains('active')) return;
    const selectedItem=inventory[selectedInventorySlot];
    if(punch.cooldown>0) return;
    const selectableWeaponClasses=new Set(['melee','ranged','magic','tool']);
    const selectedWeapon=selectedItem&&!selectedItem.wearSlot&&selectableWeaponClasses.has(selectedItem.equipmentClass)
      &&selectedItem.itemType!=='ammo'?selectedItem:null;
    const magicLevel=window.KTKPlayerStats.stats.magicLevel.value;
    const innateMagic=Boolean(event?.ctrlKey)&&magicLevel>=6&&!isMagicWeapon(selectedWeapon);
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

  function combatErrorMessage(error) {
    const message=String(error?.message||error||'');
    if(message.includes('NOT_ENOUGH_MANA')) return 'Mana insuficiente. Fique parado para regenerar mana.';
    if(message.includes('MAGIC_LEVEL_TOO_LOW')) return 'Seu nível mágico ainda é insuficiente para esse feitiço.';
    if(message.includes('ATTACK_COOLDOWN')) return 'Aguarde um instante antes de atacar novamente.';
    if(message.includes('NOT_ENOUGH_STAMINA')) return 'Estamina insuficiente para esse ataque.';
    if(message.includes('AMMO_REQUIRED')) return 'Você precisa de flechas para usar essa arma.';
    if(message.includes('STONE_AMMO_REQUIRED')) return 'Você precisa de pedras para usar o estilingue.';
    if(message.includes('ITEM_NOT_OWNED')) return 'Essa arma não está no seu inventário.';
    if(message.includes('INVALID_PROJECTILE_WEAPON')) return 'Essa arma não pode lançar projéteis.';
    if(message.includes('PLAYER_NOT_ACTIVE')) return 'Seu personagem não está ativo no mundo.';
    if(message.includes('Não foi possível sincronizar sua posição')) return message;
    return message||'O servidor recusou a ação de combate.';
  }

  function requestServerProjectile(item,direction) {
    void (async()=>{
      try {
        const gameAction=window.KTKOnline?.gameAction;
        if(typeof gameAction!=='function') throw new Error('A conexão de combate não está disponível.');
        const result=await gameAction('launch_projectile',{
          weapon_id:String(item?.id||''),
          direction:Number(direction)
        });
        if(!result?.ok) throw new Error(result?.error||'O servidor não confirmou o disparo.');
        const projectileType=item?.id==='equipment-boomerang'?'boomerang'
          : item?.id==='equipment-slingshot'?'stone'
          : item?.equipmentClass==='magic'?'magic':'arrow';
        const projectileSpeed=projectileType==='arrow'
          ? (item?.id==='equipment-crossbow'?840:720)
          : projectileType==='stone'?600
          : projectileType==='boomerang'?480:620;
        window.KTKWorldEntities?.predictProjectile?.({
          id:result.projectile_id,
          weaponId:item?.id,
          projectileType,
          direction:Number(direction),
          speed:projectileSpeed,
          maxDistance:(Number(item?.range)||1)*72
        });
        if(item?.equipmentClass==='magic') toast('Feitiço lançado.');
      } catch(error) {
        toast(combatErrorMessage(error));
      }
    })();
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

  let lastCombatMissFeedbackAt=0;

  function applyCombatHit(attacker,target,direction,confirmedProjectileContact=false,weaponItemOverride=null) {
    if(attacker!==player || !gameStarted || !Number.isInteger(Number(direction))) return false;
    const weapon=weaponItemOverride||punch.weaponItem;
    void (async()=>{
      try {
        const gameAction=window.KTKOnline?.gameAction;
        if(typeof gameAction!=='function') throw new Error('A conexão de combate não está disponível.');
        const result=await gameAction('attack',{
          direction:Number(direction),
          weapon_id:weapon?.id||null
        });
        if(!result?.ok) throw new Error(result?.error||'O servidor não confirmou o golpe.');
        if(result.state) applyServerState(result.state);

        if(!result.hit) {
          const now=performance.now();
          if(now-lastCombatMissFeedbackAt>900) {
            lastCombatMissFeedbackAt=now;
            toast('Golpe no vazio. Aproxime-se e vire-se para o adversário.');
          }
          return;
        }

        const damage=Math.max(0,Number(result.damage)||0);
        if(result.target_type==='player') {
          const remaining=Number.isFinite(Number(result.target_health))
            ? Math.max(0,Number(result.target_health)) : null;
          toast(remaining===null
            ? `Você acertou outro jogador: ${damage} de dano.`
            : `Você causou ${damage} de dano. Vida do adversário: ${remaining}.`);
          return;
        }

        if(result.target_type==='enemy') {
          const enemy=window.KTKEnemySkeleton.entity;
          startKnockback(enemy,{x:[0,-1,0,1][Number(direction)],y:[-1,0,1,0][Number(direction)]});
          if(enemy.knockback) enemy.knockback.authoritative=true;
          if(result.target_dead) toast('Esqueleto derrotado.');
          else toast(`Acertou o inimigo: ${damage} de dano.`);
        }
      } catch(error) {
        toast(combatErrorMessage(error));
      }
    })();
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
    if(item.manaCost>0) details.push(`Mana ${format(item.manaCost)}`);
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
