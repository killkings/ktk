/* Inicialização da tela inicial e fallback do criador de personagem. */
'use strict';

// Inicialização independente do botão inicial.
// Assim, a tela de criação continua abrindo mesmo se algum módulo do jogo falhar.
(() => {
  'use strict';
  const button = document.getElementById('create-start');
  const welcome = document.getElementById('welcome');
  const creator = document.getElementById('creator');
  if (!button || !welcome || !creator) return;

  function renderBasicCharacter(status) {
    const preview = document.getElementById('preview');
    const context = preview && preview.getContext('2d');
    if (!preview || !context) return;

    const root = window.KTKLPC_CONFIG?.spritesRoot;
    if (!root) throw new Error('A configuração central do LPC não foi carregada.');
    const paths = [
      'body/bodies/male/walk.png',
      'legs/pants2/male/walk.png',
      'feet/shoes/basic/male/walk.png',
      'torso/clothes/shortsleeve/shortsleeve/male/walk.png',
      'head/heads/human/male/walk.png',
      'head/faces/male/neutral/walk.png'
    ];
    const images = paths.map(path => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.src = root + path;
      return image;
    });
    const size = 64;
    const scale = 3.5;
    const left = (preview.width - size * scale) / 2;
    const top = (preview.height - size * scale) / 2;

    function draw() {
      context.clearRect(0, 0, preview.width, preview.height);
      context.imageSmoothingEnabled = false;
      let loaded = 0;
      images.forEach(image => {
        if (!image.complete || !image.naturalWidth) return;
        loaded++;
        context.drawImage(image, 0, size * 2, size, size, left, top, size * scale, size * scale);
      });
      if (status) status.textContent = loaded
        ? 'Personagem básico carregado; personalização indisponível.'
        : 'Falha ao carregar os PNGs do personagem. Verifique a pasta de sprites.';
    }

    images.forEach(image => {
      image.addEventListener('load', draw);
      image.addEventListener('error', draw);
    });
    draw();
  }

  button.addEventListener('click', () => {
    const enterButton = document.getElementById('enter-world');
    if (enterButton) enterButton.textContent = 'Entrar no mundo →';

    try {
      if (typeof window.KTKOpenCreator === 'function') {
        window.KTKOpenCreator();
        return;
      }
    } catch (error) {
      console.error('Não foi possível inicializar o criador de personagem:', error);
    }

    // Fallback: não deixa o botão parecer morto quando um módulo falha ao carregar.
    welcome.classList.remove('active');
    creator.classList.add('active');
    const status = document.getElementById('asset-status');
    if (status) {
      status.textContent = 'Tela aberta, mas os módulos de personalização não terminaram de carregar. Verifique os erros no console (F12).';
    }
    renderBasicCharacter(status);
  });
})();
