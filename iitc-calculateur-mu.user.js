// ==UserScript==
// @name         IITC plugin: Calculateur de MU
// @namespace    https://intel.ingress.com/
// @version      1.2.0
// @description  Estime les Mind Units d’un champ en sélectionnant ses trois portails sur la carte Intel.
// @author       Loupblanc1212
// @match        https://intel.ingress.com/*
// @grant        none
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  function install() {
    const id = 'loupblanc1212-mu';
    window.plugin = window.plugin || function () {};
    if (window.plugin[id]) return;
    window.plugin[id] = {};

    function setup() {
      const { L, map } = window;
      const preview = L.layerGroup().addTo(map);
      const vertices = [];
      const number = new Intl.NumberFormat('fr-CH');
      const area = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 4 });
      let request = null;
      let active = false;

      const control = L.control({ position: 'topright' });
      control.onAdd = () => {
        const container = L.DomUtil.create('div', 'leaflet-bar');
        container.style.cssText = 'background:#14252c;color:#fff;padding:8px;max-width:min(260px,65vw);';
        L.DomEvent.disableClickPropagation(container);
        L.DomEvent.disableScrollPropagation(container);

        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = 'Calculateur MU';
        toggle.setAttribute('aria-expanded', 'false');
        toggle.setAttribute('aria-controls', id);
        container.append(toggle);

        const panel = document.createElement('div');
        panel.id = id;
        panel.hidden = true;
        container.append(panel);

        const instructions = document.createElement('p');
        panel.append(instructions);

        const rows = ['A', 'B', 'C'].map((letter) => {
          const row = document.createElement('label');
          row.style.cssText = 'display:flex;gap:6px;margin:4px 0;align-items:center;';
          row.append(`${letter} `);
          const field = document.createElement('input');
          field.type = 'text';
          field.readOnly = true;
          field.style.cssText = 'width:100%;min-width:0;color:#111;background:#fff;';
          field.setAttribute('aria-label', `Coordonnées du portail ${letter}`);
          row.append(field);
          panel.append(row);
          return field;
        });

        const unlock = document.createElement('button');
        unlock.type = 'button';
        unlock.textContent = '🔓';
        unlock.title = 'Déverrouiller les portails A et B';
        unlock.setAttribute('aria-label', unlock.title);
        panel.append(unlock);

        const disclosure = document.createElement('p');
        disclosure.textContent = 'Le calcul envoie les trois coordonnées à InvestigateXM.';
        const credit = document.createElement('p');
        credit.textContent = 'Plug-in créé par Loupblanc1212';
        panel.append(disclosure, credit);

        const status = document.createElement('div');
        status.setAttribute('role', 'status');
        panel.append(status);

        function refresh() {
          instructions.textContent = vertices.length >= 2
            ? 'A et B sont verrouillés. Clique sur un portail C pour calculer les MU.'
            : 'Choisis le portail ' + (vertices.length === 0 ? 'A.' : 'B.');
          unlock.hidden = vertices.length < 2;
          rows.forEach((field, index) => {
            const vertex = vertices[index];
            field.value = vertex ? `${vertex.lat.toFixed(6)}, ${vertex.lng.toFixed(6)}` : '';
          });
          preview.clearLayers();
          if (!active) return;
          const points = vertices.map(({ lat, lng }) => [lat, lng]);
          const style = { color: '#27d5ec', weight: 3, interactive: false };
          if (points.length === 2) L.polyline(points, style).addTo(preview);
          if (points.length === 3) L.polygon(points, { ...style, fillOpacity: 0.18 }).addTo(preview);
          points.forEach((point) => L.circleMarker(point, { ...style, radius: 8, fill: false }).addTo(preview));
        }

        function cancelCalculation() {
          const previous = request;
          request = null;
          previous?.abort();
        }

        function clear() {
          cancelCalculation();
          vertices.length = 0;
          status.textContent = '';
          refresh();
        }

        toggle.addEventListener('click', () => {
          active = !active;
          panel.hidden = !active;
          toggle.setAttribute('aria-expanded', String(active));
          if (active || vertices.length >= 2) refresh();
          else clear();
        });
        unlock.addEventListener('click', clear);

        window.addHook('portalSelected', ({ selectedPortalGuid }) => {
          if (!active || !selectedPortalGuid) return;
          const point = window.portals[selectedPortalGuid]?.getLatLng();
          if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
          if (vertices.slice(0, 2).some(({ guid, lat, lng }) => guid === selectedPortalGuid ||
              (lat.toFixed(6) === point.lat.toFixed(6) && lng.toFixed(6) === point.lng.toFixed(6)))) {
            if (!request) status.textContent = 'Choisis un autre portail.';
            return;
          }
          cancelCalculation();
          const index = Math.min(vertices.length, 2);
          vertices[index] = { guid: selectedPortalGuid, lat: point.lat, lng: point.lng };
          if (vertices.length === 3) calculate();
          else {
            status.textContent = '';
            refresh();
          }
        });

        async function calculate() {
          const controller = new AbortController();
          request = controller;
          const timer = setTimeout(() => controller.abort(), 25000);
          status.textContent = 'Calcul en cours…';
          refresh();
          try {
            const response = await fetch('https://api.investigatexm.com/getMU', {
              method: 'POST',
              credentials: 'omit',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ coordinates: vertices.map(({ lat, lng }) => ({ lat, lng })) }),
              signal: controller.signal,
            });
            if (!response.ok) {
              if (response.status === 400) throw new Error('Ces trois points ne forment pas un champ valide.');
              throw new Error(`Le service a renvoyé une erreur (${response.status}). Réessaie.`);
            }
            const result = await response.json();
            if (!Number.isSafeInteger(result.mu) || result.mu < 0 ||
                !Number.isFinite(result.area_km2) || result.area_km2 < 0) {
              throw new Error('Le service a renvoyé un résultat illisible.');
            }
            if (request === controller) {
              status.textContent = `Estimation ${number.format(result.mu)} MU · ${area.format(result.area_km2)} km²`;
            }
          } catch (error) {
            if (request === controller) {
              if (controller.signal.aborted) status.textContent = 'Le calcul a pris trop de temps. Réessaie.';
              else if (error instanceof TypeError) status.textContent = 'Service inaccessible. Vérifie la connexion et réessaie.';
              else status.textContent = error.message;
            }
          } finally {
            clearTimeout(timer);
            if (request === controller) request = null;
          }
        }

        refresh();
        return container;
      };
      control.addTo(map);
    }

    setup.info = { pluginId: id, buildName: 'release', dateTimeVersion: '20261119.120000' };
    window.bootPlugins = window.bootPlugins || [];
    window.bootPlugins.push(setup);
    if (window.iitcLoaded) setup();
  }

  const script = document.createElement('script');
  script.textContent = `(${install.toString()})();`;
  (document.head || document.documentElement).append(script);
  script.remove();
})();
