/* Controles e interface do criador de personagem. */
'use strict';

  function showScreen(which) {
    screens.welcome.classList.toggle('active', which === 'welcome');
    screens.death.classList.toggle('active', which === 'death');
    screens.creator.classList.toggle('active', which === 'creator');
    screens.game.classList.toggle('active', which === 'game');
    if (which === 'game') resize();
  }

  function colorButtons(group, targetId, labelId) {
    const holder = document.getElementById(targetId);
    holder.innerHTML = '';
    const selectedId = character[group];
    palettes[group].forEach(item => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'swatch' + (selectedId === item.id ? ' selected' : '');
      btn.style.background = item.color;
      btn.title = item.name;
      btn.setAttribute('aria-label', item.name);
      btn.addEventListener('click', () => {
        character[group] = item.id;
        updateCreator();
      });
      holder.appendChild(btn);
    });
    const selected = palettes[group].find(item => item.id === selectedId);
    document.getElementById(labelId).textContent = selected ? selected.name : '';
  }

  function populateOptions(selectId, options) {
    const select=document.getElementById(selectId);
    select.innerHTML='';
    options.forEach(([value,label])=>{
      const option=document.createElement('option');
      option.value=value;
      option.textContent=label;
      select.appendChild(option);
    });
  }

  function populateCatalogOptions(selectId, catalog, selectedId, fallbackId) {
    const available=(Array.isArray(catalog)?catalog:[]).filter(item=>item.availableFor.includes(character.gender));
    const selection=available.some(item=>item.id===selectedId)
      ? selectedId
      : (available.find(item=>item.id===fallbackId)?.id || available[0]?.id || '');
    const select=document.getElementById(selectId);
    populateOptions(selectId,available.map(item=>[item.id,item.name]));
    select.value=selection;
    available.forEach((item,index)=>{
      const layers=item.layers[character.gender] || [];
      const paths=layers.map(layer=>layer.path).join(' + ');
      select.options[index].title=item.sourceName+
        (item.definition?' · '+item.definition:'')+
        (paths?' · '+paths:' · sem camada de sprite');
    });
    return selection;
  }

  function updateCreatorControls() {
    colorButtons('skin','skin-swatches','skin-name');
    colorButtons('eyes','eye-swatches','eye-name');
    colorButtons('hair','hair-swatches','hair-name');
    document.getElementById('gender-name').textContent = character.gender === 'male' ? 'Masculino' : 'Feminino';
    document.querySelectorAll('[data-gender]').forEach(btn => {
      btn.classList.toggle('selected', btn.dataset.gender === character.gender);
    });
    character.hairstyle=populateCatalogOptions(
      'hairstyle-select',window.KTKHairStyles || [],character.hairstyle,'hair_pixie'
    );
    character.beard=populateCatalogOptions(
      'beard-select',window.KTKBeardStyles || [],character.beard,'none'
    );
    character.mustache=populateCatalogOptions(
      'mustache-select',window.KTKMustacheStyles || [],character.mustache,'none'
    );
    const hairstyle=(window.KTKHairStyles || []).find(item=>item.id===character.hairstyle);
    document.getElementById('style-name').textContent = hairstyle ? hairstyle.name : '';
  }
