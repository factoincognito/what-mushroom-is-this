import { add } from "./example";
import "./style.css";

const app = document.getElementById("app");
if (app) {
  app.textContent = `2 + 3 = ${add(2, 3)}`;
}
