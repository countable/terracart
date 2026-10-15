// Living-silver chassis. Existing game controls keep their listeners and state;
// this layer only seats them in the relic and closes unpowered mechanisms.
const CompassHUD = {
  modules: { memories: 'memories', bookchip: 'books', roadchip: 'distance',
    'inv-tabs': 'inventory', inv: 'inventory', 'move-pad': 'joystick' },
  install(scene) {
    if (typeof document === 'undefined' || scene._compassHUD) return;
    scene._compassHUD = true;
    document.body.classList.add('compass-hud');
    document.body.classList.toggle('compass-round', typeof HeadingUp !== 'undefined' && HeadingUp.enabled);
    const body = document.createElement('div');
    body.id = 'compass-body';
    body.setAttribute('aria-hidden', 'true');
    body.innerHTML = '<div class="compass-aperture"></div><div class="compass-header"></div><div class="compass-footer"></div><div class="compass-bearing"><i class="compass-ticks"></i><span>▲<b>N</b></span><span class="compass-east"><b>E</b></span><span class="compass-south"><b>S</b></span><span class="compass-west"><b>W</b></span></div>';
    document.body.append(body);
    const inventory = document.createElement('button');
    inventory.id = 'compass-inventory-shutter';
    inventory.type = 'button';
    inventory.textContent = 'Inventory';
    inventory.setAttribute('aria-label', 'Inventory not activated');
    inventory.addEventListener('click', () => CompassModules.tap(scene, 'inventory'));
    document.body.append(inventory);
    const summary = document.querySelector('#menu summary');
    if (summary) {
      for (const node of [...summary.childNodes]) if (node.nodeType === 3) node.textContent = '✥';
      summary.setAttribute('aria-label', 'Main menu');
    }
    const energy = document.getElementById('energy');
    if (energy) {
      const needle = document.createElement('i');
      needle.className = 'compass-energy-needle';
      needle.setAttribute('aria-hidden', 'true');
      energy.prepend(needle);
      energy.tabIndex = 0;
      energy.setAttribute('role', 'button');
      energy.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); energy.click(); }
      });
    }
    // Capture before existing listeners; inventory nodes are rebuilt on pickup.
    const gate = e => {
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
      body.remove(); inventory.remove();
      document.body.classList.remove('compass-hud', 'compass-round');
    });
    this.update(scene);
  },
  update(scene) {
    if (!scene._compassHUD) return;
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
      if (!el.dataset.compassLabel) el.dataset.compassLabel = CompassModules.MODULES[id];
      if (elementId !== 'inv' && elementId !== 'inv-tabs') {
        if (!el._compassKeyboard) {
          el.tabIndex = 0;
          el.setAttribute('role', 'button');
          el._compassKeyboard = true;
          el.addEventListener('keydown', e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            if (id === 'joystick') CompassModules.tap(scene, id);
            else el.click();
          });
        }
      }
    }
    const energy = document.getElementById('energy');
    const value = Math.max(0, scene.save.energy || 0), max = scene.getMaxEnergy();
    const key = `${value}|${max}`;
    if (energy && scene._compassEnergy !== key) {
      scene._compassEnergy = key;
      energy.style.setProperty('--energy-angle', `${-65 + Math.min(1, value / Math.max(1, max)) * 130}deg`);
      energy.setAttribute('aria-label', `Energy ${value} of ${max}`);
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
