import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initTheme } from "./theme";
import "./styles.css";
import "./dark.css";
import "./aurora.css";

initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
