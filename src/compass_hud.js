// Living-silver chassis. Existing game controls keep their listeners and state;
// this layer only seats them in the relic and closes unpowered mechanisms.
const CompassHUD = {
  // These geometric inscriptions are decorative, not a translated language.
  // English module names remain in accessible labels and Spirit dialog copy.
  inscriptions: { inventory: '⋈ ⌖ ⋄ ⊓ ⌇', memories: '⌖ ⋄ ⋈ ⌇ ⊓', books: '⊓ ⌇ ⋄ ⌖ ⋈', distance: '⋄ ⊓ ⌖ ⋈ ⌇', joystick: '⌇ ⋈ ⊓ ⋄ ⌖' },
  modules: { memories: 'memories', bookchip: 'books', roadchip: 'distance',
    'inv-tabs': 'inventory', inv: 'inventory', 'move-pad': 'joystick' },
  install(scene) {
    if (typeof document === 'undefined' || scene._compassHUD) return;
    scene._compassHUD = true;
    const cleanup = [];
    scene._compassKeyboardBindings = [];
    scene._compassDecorations = [];
    document.body.classList.add('compass-hud');
    document.body.classList.toggle('compass-round', typeof HeadingUp !== 'undefined' && HeadingUp.enabled);
    const body = document.createElement('div');
    body.id = 'compass-body';
    body.setAttribute('aria-hidden', 'true');
    body.innerHTML = '<div class="compass-aperture"></div><div class="compass-header"></div><div class="compass-footer"></div><div class="compass-upper-join"></div><div class="compass-lower-join"></div><div class="compass-bearing"><i class="compass-ticks"></i><span class="compass-north"><img src="assets/ui/compass/north-arrow.webp" alt="" aria-hidden="true"></span><span class="compass-east"><b>E</b></span><span class="compass-south"><b>S</b></span><span class="compass-west"><b>W</b></span></div>';
    document.body.append(body);
    // The memory's pixel pickup has a pale outline. Its instrument uses a
    // clean faceted gold star, without altering the world pickup artwork.
    const memoryIcon = document.querySelector('#memories .mem-ico');
    if (memoryIcon) {
      const star = document.createElement('img');
      star.className = 'mem-ico compass-memory-star';
      star.src = 'assets/ui/compass/memory-star.svg';
      star.alt = '';
      memoryIcon.replaceWith(star);
      cleanup.push(() => star.replaceWith(memoryIcon));
    }
    // One glass display, with two independent controls and power circuits.
    const knowledge = document.createElement('div');
    knowledge.id = 'compass-knowledge-display';
    knowledge.setAttribute('role', 'group');
    knowledge.setAttribute('aria-label', 'Memories and books');
    const hudRow = document.getElementById('hud-row');
    for (const id of ['memories', 'bookchip']) {
      const chip = document.getElementById(id);
      if (chip) knowledge.append(chip);
    }
    hudRow?.append(knowledge);
    const inventory = document.createElement('button');
    inventory.id = 'compass-inventory-shutter';
    inventory.type = 'button';
    inventory.textContent = 'Inventory';
    inventory.dataset.runeLabel = this.inscriptions.inventory;
    inventory.setAttribute('aria-label', 'Inventory not activated');
    inventory.addEventListener('click', () => CompassModules.tap(scene, 'inventory'));
    document.body.append(inventory);
    // Dismiss only this scene's cover, never its underlying power circuit.
    // Keep the close control beside the shutter, not nested in its button.
    const dismissInventory = document.createElement('button');
    dismissInventory.id = 'compass-inventory-dismiss';
    dismissInventory.type = 'button';
    dismissInventory.textContent = '×';
    dismissInventory.setAttribute('aria-label', 'Dismiss inactive inventory cover');
    dismissInventory.addEventListener('click', event => {
      event.stopPropagation();
      document.body.classList.add('compass-inventory-dismissed');
    });
    document.body.append(dismissInventory);
    const summary = document.querySelector('#menu summary');
    if (summary) {
      for (const node of [...summary.childNodes]) if (node.nodeType === 3) {
        const text = node.textContent;
        cleanup.push(() => { node.textContent = text; });
        node.textContent = '';
      }
      const menuGlyph = document.createElement('span');
      menuGlyph.className = 'compass-menu-glyph';
      menuGlyph.setAttribute('aria-hidden', 'true');
      menuGlyph.innerHTML = '<svg viewBox="0 0 32 32"><path d="M4 4h10v10H4zM18 4h10v10H18zM4 18h10v10H4zM18 18h10v10H18z"/></svg>';
      summary.prepend(menuGlyph);
      scene._compassDecorations.push(menuGlyph);
      summary.setAttribute('aria-label', 'Main menu');
    }
    const energy = document.getElementById('energy');
    if (energy) {
      const needle = document.createElement('i');
      needle.className = 'compass-energy-needle';
      needle.setAttribute('aria-hidden', 'true');
      needle.innerHTML = '<svg viewBox="0 0 100 100"><defs><linearGradient id="compass-needle-gold" x2="1" y2="0"><stop stop-color="#ac751c"/><stop offset=".45" stop-color="#fff2b0"/><stop offset="1" stop-color="#dfaa32"/></linearGradient></defs><path d="M52 12L39 36H48L43 55L61 29H51Z" fill="url(#compass-needle-gold)" stroke="#78531d" stroke-width="1.4" stroke-linejoin="round"/></svg>';
      energy.prepend(needle);
      const face = document.createElement('span');
      face.className = 'compass-energy-face';
      face.setAttribute('aria-hidden', 'true');
      face.innerHTML = '<svg viewBox="0 0 100 100"><defs><pattern id="compass-dial-texture" patternUnits="userSpaceOnUse" width="100" height="100"><image href="assets/ui/compass/silver-metal.webp" width="100" height="100" preserveAspectRatio="xMidYMid slice"/></pattern><radialGradient id="compass-dial-metal" cx="32%" cy="20%" r="90%"><stop stop-color="#ded9cf"/><stop offset=".3" stop-color="#b8b4ab"/><stop offset=".64" stop-color="#96938b"/><stop offset="1" stop-color="#6e6d66"/></radialGradient></defs><circle cx="50" cy="50" r="45" fill="url(#compass-dial-texture)"/><circle cx="50" cy="50" r="45" fill="url(#compass-dial-metal)" fill-opacity=".82" stroke="#cbc5ba" stroke-opacity=".6" stroke-width="1.5"/><path d="M14.65 38.52A39 39 0 0 1 85.35 38.52" fill="none" stroke="#41423e" stroke-width="10" stroke-linecap="round"/><g fill="none" stroke-width="6" stroke-linecap="butt"><path d="M14.65 38.52A39 39 0 0 1 35.60 18.75" stroke="#d94c39"/><path d="M37.05 18.22A39 39 0 0 1 62.95 18.22" stroke="#edc34d"/><path d="M64.40 18.75A39 39 0 0 1 85.35 38.52" stroke="#77c54c"/></g></svg><span class="compass-energy-pivot"></span>';
      energy.prepend(face);
      scene._compassDecorations.push(needle, face);
      energy.tabIndex = 0;
      energy.setAttribute('role', 'button');
      const energyKeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); energy.click(); }
      };
      energy.addEventListener('keydown', energyKeydown);
      cleanup.push(() => energy.removeEventListener('keydown', energyKeydown));
    }
    // Capture before existing listeners; inventory nodes are rebuilt on pickup.
    const gate = e => {
      // Phaser's canvas extends behind the relic. Metal outside the circular
      // aperture must not turn a decorative-surface tap into a world action.
      if (e.target.tagName === 'CANVAS' && document.body.classList.contains('compass-round')) {
        const aperture = body.querySelector('.compass-aperture').getBoundingClientRect();
        const x = (e.clientX - aperture.left - aperture.width / 2) / (aperture.width / 2);
        const y = (e.clientY - aperture.top - aperture.height / 2) / (aperture.height / 2);
        if (x * x + y * y > 1) {
          e.preventDefault(); e.stopImmediatePropagation();
          return;
        }
      }
      const control = e.target.closest?.('#memories,#bookchip,#roadchip,#inv-tabs,#inv,#move-pad');
      const id = control && this.modules[control.id];
      if (!id || CompassModules.isActive(scene.save, id)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === 'click' || control.id === 'move-pad') CompassModules.tap(scene, id);
    };
    document.addEventListener('click', gate, true);
    document.addEventListener('pointerdown', gate, true);
    scene.events?.once('shutdown', () => {
      document.removeEventListener('click', gate, true);
      document.removeEventListener('pointerdown', gate, true);
      for (const dispose of cleanup) dispose();
      for (const node of scene._compassDecorations) node.remove();
      for (const [el, handler] of scene._compassKeyboardBindings) {
        el.removeEventListener('keydown', handler);
        delete el._compassKeyboard;
        delete el._compassActive;
      }
      for (const elementId of Object.keys(this.modules)) document.getElementById(elementId)?.classList.remove('compass-closed');
      for (const id of new Set(Object.values(this.modules))) document.body.classList.remove(`compass-${id}-closed`);
      body.remove(); inventory.remove(); dismissInventory.remove();
      knowledge.replaceWith(...knowledge.children);
      document.body.classList.remove('compass-hud', 'compass-round', 'compass-inventory-dismissed');
      scene._compassHUD = false;
      delete scene._compassEnergy;
      delete scene._compassBearing;
      delete scene._compassKeyboardBindings;
      delete scene._compassDecorations;
    });
    this.update(scene);
  },
  update(scene) {
    if (!scene._compassHUD) return;
    const money = document.getElementById('money');
    const moneyHidden = !scene.save.storySeen?.['coin:first'];
    if (money && money.hidden !== moneyHidden) money.hidden = moneyHidden;
    for (const id of Object.values(this.modules)) {
      const closed = !CompassModules.isActive(scene.save, id);
      document.body.classList.toggle(`compass-${id}-closed`, closed);
    }
    for (const [elementId, id] of Object.entries(this.modules)) {
      const el = document.getElementById(elementId);
      if (!el) continue;
      const active = CompassModules.isActive(scene.save, id);
      el.classList.toggle('compass-closed', !active);
      if (el._compassActive !== active) {
        el._compassActive = active;
        el.setAttribute('aria-label', CompassModules.MODULES[id] + (active ? '' : ' not activated, power low'));
      }
      if (!el.dataset.compassLabel) el.dataset.compassLabel = this.inscriptions[id];
      if (elementId !== 'inv' && elementId !== 'inv-tabs') {
        if (!el._compassKeyboard) {
          el.tabIndex = 0;
          el.setAttribute('role', 'button');
          el._compassKeyboard = true;
          const handler = e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (id === 'joystick') CompassModules.tap(scene, id);
            else el.click();
          };
          el.addEventListener('keydown', handler);
          scene._compassKeyboardBindings.push([el, handler]);
        }
      }
    }
    // The owning road HUD still writes its accessible distance label. Re-seat
    // those same characters in individual physical wheels after each update.
    const distance = document.querySelector('#roadchip .road-num');
    if (distance && !distance.querySelector('.compass-wheel')) {
      const label = distance.textContent.trim();
      const match = label.match(/^([\d.,]+)\s*(.*)$/);
      if (match) {
        distance.setAttribute('aria-label', label);
        const digits = /^0[.,]/.test(match[1]) ? match[1].slice(1) : match[1].padStart(3, '0');
        distance.replaceChildren();
        for (const character of digits) {
          const wheel = document.createElement('span');
          wheel.className = 'compass-wheel' + (/\d/.test(character) ? '' : ' compass-wheel-separator');
          wheel.textContent = character;
          if (/\d/.test(character)) {
            wheel.dataset.previous = (Number(character) + 9) % 10;
            wheel.dataset.next = (Number(character) + 1) % 10;
          }
          wheel.setAttribute('aria-hidden', 'true');
          distance.append(wheel);
        }
        const unit = document.createElement('span');
        unit.className = 'compass-wheel compass-wheel-unit';
        unit.textContent = match[2];
        unit.setAttribute('aria-hidden', 'true');
        distance.append(unit);
      }
    }
    const pad = document.getElementById('move-pad');
    if (pad && !pad.querySelector('.compass-stick-directions')) {
      const directions = document.createElement('span');
      directions.className = 'compass-stick-directions';
      directions.setAttribute('aria-hidden', 'true');
      // U+FE0E asks for the TEXT glyph: phones otherwise draw ▶ and ◀ as
      // blue emoji keys.
      directions.innerHTML = '<i>▲\uFE0E</i><i>▶\uFE0E</i><i>▼\uFE0E</i><i>◀\uFE0E</i>';
      pad.append(directions);
      scene._compassDecorations.push(directions);
      const seal = document.createElement('span');
      seal.className = 'compass-stick-seal';
      seal.setAttribute('aria-hidden', 'true');
      seal.innerHTML = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="43"/><circle cx="50" cy="50" r="36"/><path class="rose-shadow" d="M50 6L57 42L79 21L58 46L94 50L58 57L79 79L54 58L50 94L43 58L21 79L42 54L6 50L42 43L21 21L46 42Z"/><path class="rose-light" d="M50 6L50 50L57 42ZM94 50L50 50L58 57ZM50 94L50 50L43 58ZM6 50L50 50L42 43Z"/><circle cx="50" cy="50" r="4"/></svg>';
      pad.append(seal);
      scene._compassDecorations.push(seal);
    }
    const energy = document.getElementById('energy');
    const value = Math.max(0, scene.save.energy || 0), max = scene.getMaxEnergy();
    const key = `${value}|${max}`;
    if (energy && scene._compassEnergy !== key) {
      scene._compassEnergy = key;
      energy.style.setProperty('--energy-angle', `${-65 + Math.min(1, value / Math.max(1, max)) * 130}deg`);
      energy.setAttribute('aria-label', `Energy ${value} of ${max}`);
      const label = document.getElementById('energy-label');
      if (label) label.textContent = max;
    }
    const bearing = document.querySelector('.compass-bearing');
    const angle = scene.mapRot || 0;
    if (bearing && scene._compassBearing !== angle) {
      scene._compassBearing = angle;
      bearing.style.transform = `rotate(${angle}rad)`;
      for (const letter of bearing.querySelectorAll('b')) letter.style.transform = `rotate(${-angle}rad)`;
    }
  },
};
