import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { Button } from '@heroui/react';

// React Aria normalizes keyboard, pointer, and assistive-technology activation.
// Forward its press event to the existing workbench without relying on a click.
function forwardPress(event) {
  event.target.dispatchEvent(new CustomEvent('signal-lab-press'));
}

function Symbol({ name }) {
  return <svg className="material-icon" aria-hidden="true"><use href={`material-symbols.svg#${name}`} /></svg>;
}

function MainModes() {
  return <>
    <Button onPress={forwardPress} data-page="encoder" className="nav active" variant="ghost"><Symbol name="north_east" /> Encoder</Button>
    <Button onPress={forwardPress} data-page="decoder" className="nav" variant="ghost"><Symbol name="south_west" /> Decoder</Button>
  </>;
}

function ExtraModes() {
  return <>
    <Button onPress={forwardPress} data-page="learn" className="nav" variant="ghost">Learn</Button>
    <Button onPress={forwardPress} data-page="history" className="nav" variant="ghost">Log <span id="count" className="count">0</span></Button>
  </>;
}

function ProtocolModes() {
  return <>
    <Button onPress={forwardPress} id="custom-mode" className="selected" aria-pressed="true" variant="ghost">Custom data</Button>
    <Button onPress={forwardPress} id="same-mode" aria-pressed="false" variant="ghost">EAS / SAME</Button>
    <Button onPress={forwardPress} id="morse-mode" aria-pressed="false" variant="ghost">Morse</Button>
  </>;
}

// The rest of the workbench retains its existing state and audio engine. Render
// these islands synchronously so its event handlers and localization find them.
for (const [selector, Component] of [['.main-modes', MainModes], ['.extra-modes', ExtraModes], ['.protocol-switch', ProtocolModes]]) {
  const host = document.querySelector(selector);
  if (host) flushSync(() => createRoot(host).render(<Component />));
}
