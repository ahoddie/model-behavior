// The saved light or dark choice, applied by an inline script in the layout before the page paints, so a dark page never
// flashes light first. It lives outside the "use client" ThemeToggle module because the server layout must get the string
// itself: a value imported from a client module arrives in a server component as a client reference, not as text.
export const THEME_KEY = "theme";
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";document.documentElement.dataset.theme=t}catch(e){}`;
