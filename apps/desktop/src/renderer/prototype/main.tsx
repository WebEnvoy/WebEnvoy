import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../uiFoundation.css";
import "../styles.css";
import "./humanWorkbenchPrototype.css";
import "./prototypeSurfaces.css";
import "./prototypeFlows.css";
import { HumanWorkbenchPrototype } from "./HumanWorkbenchPrototype";

document.documentElement.dataset.weTheme = "light";

const root = document.getElementById("root");

if (root == null) {
  throw new Error("Prototype root element is missing.");
}

createRoot(root).render(
  <StrictMode>
    <HumanWorkbenchPrototype />
  </StrictMode>,
);
