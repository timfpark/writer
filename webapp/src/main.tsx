// Global styles load first, so component modules override them.
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createQueryClient } from "./api/queries";
import { App } from "./App";
import { createAppRouter } from "./router";

const container = document.getElementById("root");
if (!container) {
  throw new Error("index.html must contain an element with id 'root'");
}

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

createRoot(container).render(
  <StrictMode>
    <App queryClient={queryClient} router={router} />
  </StrictMode>,
);
