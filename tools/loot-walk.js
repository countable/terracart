/* Fast walking-to-loot draft. All expensive generation happens offline. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const distance = m => m < 1000 ? `${m} m` : `${m / 1000} km`;
  const number = value => {
    if (!value) return '0';
    if (value < .01) return '<0.01';
    return value.toLocaleString('en', { maximumFractionDigits: value < 1 ? 2 : 1 });
  };
  const whole = value => Math.round(value).toLocaleString('en');
  const percent = value => `${Math.round(value * 100)}%`;
  const title = value => String(value).replaceAll('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
  let model, rewards, selected = 2;
  const order = ['chest-t1', 'chest-t2', 'chest-t3', 'chest-t4', 'chest-t5', 'buried', 'trail', 'barrel-barrel', 'barrel-clay pot', 'headstone', 'shrine', 'chapel', 'enemy-wages', 'enemy-bonus', 'elite-bonus'];
  const labels = { 'barrel-barrel': 'Barrels', 'barrel-clay pot': 'Clay pots', buried: 'Buried treasure', trail: 'Road prizes', headstone: 'Headstone hoards', shrine: 'Grove shrine gifts', chapel: 'Chapel alms' };
  function enemyProbability(enemy, index) {
    const probability = model.coverage[index];
    return 1 - Math.pow(1 - probability, enemy.count);
  }
  function cells(values) {
    return values.map((n, i) => `<td class="${i === selected ? 'selected ' : ''}${n === 0 ? 'zero' : ''}" title="${esc(n.toFixed(4))} expected">${esc(number(n))}</td>`).join('');
  }
  function renderTable() {
    $('walk-head').innerHTML = `<tr><th scope="col">Reward opportunity</th>${model.distancesM.map((d, i) => `<th scope="col"><button class="distance-button" data-distance="${i}" aria-pressed="${i === selected}" aria-label="Inspect treasure after ${distance(d)}">${distance(d)}</button></th>`).join('')}</tr>`;
    const rows = [...model.rows].sort((a, b) => (order.includes(a.id) ? order.indexOf(a.id) : 99) - (order.includes(b.id) ? order.indexOf(b.id) : 99));
    let html = rows.map(row => {
      const note = row.id === 'trail' ? 'One reward kept per prize' : ({ 'enemy-wages': 'Assumes every encounter is won', 'enemy-bonus': '10% chance on eligible enemies', 'elite-bonus': 'First of each kind gives a memory instead' }[row.id] || row.note || '');
      return `<tr><th scope="row" title="${row.count == null ? 'Uses the game’s restoration ladder' : `${whole(row.count)} in the sample tiles`}">${esc(labels[row.id] || row.label)}${note ? `<small class="row-note">${esc(note)}</small>` : ''}</th>${cells(row.expected)}</tr>`;
    }).join('');
    const totals = model.distancesM.map((_, i) => rows.reduce((sum, r) => sum + r.expected[i], 0));
    html += `<tr class="total"><th scope="row">Total reward opportunities</th>${cells(totals)}</tr>`;
    $('walk-body').innerHTML = html;
    $('walk-head').querySelectorAll('button').forEach(button => button.addEventListener('click', () => select(Number(button.dataset.distance), true)));
  }
  function renderContext() {
    const label = distance(model.distancesM[selected]);
    $('enemy-title').textContent = `Enemy encounters at ${label}`;
    const enemies = [...model.enemies].sort((a, b) => b.count - a.count);
    const chip = e => `<span class="enemy-chip" title="${number(e.expected[selected])} expected encounters; ${percent(enemyProbability(e, selected))} chance of at least one">${esc(e.label || title(e.kind))}<small>${percent(enemyProbability(e, selected))}</small></span>`;
    $('enemies').innerHTML = enemies.length ? enemies.slice(0, 6).map(chip).join('') + (enemies.length > 6 ? `<details class="more-enemies"><summary>${enemies.length - 6} more kinds</summary><div class="extra-enemies">${enemies.slice(6).map(chip).join('')}</div></details>` : '') : '<span class="quiet">No individual enemy kind reaches 50% yet. An encounter is still possible.</span>';
  }
  function renderLoot() {
    const data = rewards.distances[selected], label = distance(data.distanceM);
    $('selected-distance').textContent = label;
    $('distance-select').value = String(selected);
    $('sampling-note').textContent = `${whole(rewards.trials)} seeded possible walks · shipping reward tables · fixed starting gear`;
    $('haul-summary').innerHTML = [
      ['Coins collected', number(data.meanCoins), `10th–90th percentile: ${whole(data.coinDistribution.p10)}–${whole(data.coinDistribution.p90)}`],
      ['Item units collected', number(data.meanItemCount), 'Mean units, including stacked items'],
      ['Gross list value', number(data.meanValue), `10th–90th percentile: ${whole(data.valueDistribution.p10)}–${whole(data.valueDistribution.p90)}`],
    ].map(([label, value, note]) => `<div class="stat"><div class="stat-label">${label}</div><div class="stat-value">${value}</div><div class="stat-note">${note}</div></div>`).join('');
    const groups = data.classes.slice(0, 7);
    if (data.classes.length > 7) groups.push({ label: 'Other', share: data.classes.slice(7).reduce((sum, r) => sum + r.share, 0) });
    $('class-distribution').innerHTML = groups.length ? groups.map(r => `<div class="bar-row"><span>${esc(title(r.label))}</span><div class="bar-track"><div class="bar-fill" style="width:${r.share * 100}%;${r.label === 'Coins' ? 'background:var(--gold)' : ''}"></div></div><span class="bar-value">${percent(r.share)}</span></div>`).join('') : '<p class="quiet">No rewards in these sampled walks.</p>';
    $('top-items').innerHTML = data.topItems.slice(0, 7).map(item => `<tr><td>${esc(item.label)}</td><td>${esc(number(item.expectedQty))}</td><td>${percent(item.probability)}</td></tr>`).join('') || '<tr><td colspan="3">No items in these sampled walks.</td></tr>';
    $('examples').innerHTML = data.examples.map((bag, i) => {
      const line = r => `<li><span>${esc(r.label)}</span><span>× ${whole(r.qty)}</span></li>`;
      const extra = bag.rewards.slice(6);
      return `<article class="backpack"><div class="backpack-head">Walk ${i + 1}<span>${whole(bag.coins)} coins</span></div>${bag.rewards.length ? `<ul>${bag.rewards.slice(0, 6).map(line).join('')}</ul>` : '<p class="quiet" style="margin:17px 0">No item finds on this walk.</p>'}${extra.length ? `<details><summary>${extra.length} more item types</summary><ul>${extra.map(line).join('')}</ul></details>` : ''}<p class="bag-value">${bag.memories ? `${whole(bag.memories)} memories · ` : ''}List value ${whole(bag.value)} · sample ${bag.seed}</p></article>`;
    }).join('');
    $('reward-caveat').textContent = 'Gross rewards from the modeled sources, not a final inventory. Starting equipment and luck stay fixed: no gear progression, bag limits, energy costs, purchases or selling. Tutorial guarantees, fixed supplies and cave/quest rewards are outside this draft. Street prizes keep one offered card.';
  }
  function select(index, retainFocus = false) {
    selected = index;
    const focusIndex = retainFocus ? index : null;
    renderTable(); renderContext(); renderLoot();
    if (focusIndex !== null) $('walk-head').querySelector(`[data-distance="${focusIndex}"]`).focus({ preventScroll: true });
    document.documentElement.dataset.selectedDistance = String(model.distancesM[index]);
  }
  function renderMethod() {
    const s = model.source, a = model.assumptions;
    $('source').textContent = `${s.tileIds.length} Kelowna tiles · ${(s.walkableAreaM2 / 1e6).toFixed(2)} km² modeled walkable area · ${title(s.difficulty)} mode`;
    $('assumptions-body').innerHTML = `<p><strong>Exploration model, not a tutorial forecast.</strong> Cumulative avatar walking distance, not distance from Home. The first 100 m do not include guaranteed starter supplies.</p><p>A ${a.corridorWidthM} m search corridor at ${percent(a.routeEfficiency)} fresh-route efficiency. Each available reward can be found once; longer walks gradually exhaust the finite sample.</p><p><strong>Expected encounters</strong><br>Available count × (1 − exp(−walk × search width × efficiency ÷ walkable area)).</p><p>${esc(a.strategy)}</p><p>${esc(a.combatNote)}</p><p>${esc(a.roadNote)}</p><p>${esc(a.scope)}</p><p>${esc(a.caveat)}</p><p><strong>Reward sampling</strong></p><ul>${rewards.assumptions.map(text => `<li>${esc(text)}</li>`).join('')}</ul><p><strong>Not counted as random rolls</strong><br>${Object.entries(model.excluded || {}).map(([key, n]) => `${esc(key)} (${whole(n)})`).join(', ')}.</p>`;
    $('milestones').innerHTML = model.milestones.map(m => {
      const match = m.trigger.match(/^(\d+) lifetime memories/);
      const milestoneLabel = m.label.replace('Second tower revelation', 'Second tower');
      return `<div class="milestone" title="${esc(m.trigger)}"><b>${match ? `${match[1]} memories` : 'Starter actions'}</b><span>${esc(milestoneLabel)}</span></div>`;
    }).join('');
    const date = new Date(s.generatedAt).toLocaleDateString('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' });
    $('provenance').textContent = `Snapshot ${date} · source ${s.revision.slice(0, 6)} · density model, not an exact route`;
  }
  async function start() {
    try {
      [model, rewards] = await Promise.all(['data/loot-walk-model.json', 'data/loot-walk-rewards.json'].map(async url => {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) throw new Error(`Could not load ${url} (${r.status}).`);
        return r.json();
      }));
      if (model.distancesM.length !== 9 || rewards.distances.some((d, i) => d.distanceM !== model.distancesM[i]) || rewards.distances.length !== 9) throw new Error('The walking and reward snapshots do not match. Regenerate both together.');
      $('distance-select').innerHTML = model.distancesM.map((d, i) => `<option value="${i}">${distance(d)}</option>`).join('');
      $('distance-select').addEventListener('change', event => select(Number(event.target.value)));
      renderMethod(); select(selected);
      $('status').textContent = '';
      document.documentElement.dataset.lootWalkReady = 'true';
      window.lootWalk = { model, rewards };
    } catch (error) {
      $('status').className = 'error';
      $('status').textContent = `${error.message} Serve this draft over HTTP and check the saved model files.`;
    }
  }
  start();
})();
