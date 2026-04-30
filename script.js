const screen = document.getElementById("screen");
const startBtn = document.getElementById("startBtn1");
const startBtn2 = document.getElementById("startBtn2");
startBtn.textContent = "episodio 1";
startBtn2.textContent = "episodio 2";

if (screen) {
  setInterval(() => {
    screen.classList.toggle("flicker");
  }, 2200);
}

if (startBtn) {
  startBtn.addEventListener("mouseenter", () => {
    startBtn.textContent = "apri episodio 1";
  });

  startBtn.addEventListener("mouseleave", () => {
    startBtn.textContent = "episodio 1";
  });
}

if (startBtn2) {
  startBtn2.addEventListener("mouseenter", () => {
    startBtn2.textContent = "apri episodio 2";
  });

  startBtn2.addEventListener("mouseleave", () => {
    startBtn2.textContent = "episodio 2";
  });
}
