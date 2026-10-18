// ongaku.band — track list
//
// Each track is a short preview (30 s, 128 kbps mp3) cut from the full song,
// played while a cover is hovered (or tapped on touch screens).
// Give a track its own `cover` to override the band's artwork.
// Each band's `about` is the little description shown next to its cover.

const BANDS = {
  the5to8s: {
    name: "The 5to8s",
    url: "https://the5to8s.ongaku.band",
    accent: "#e0902f",
    about: "An 8 piece band cooking funk, soul and hip hop into one big jam. Loose, groovy and gloriously unpredictable. You never know where the next song is headed.",
    cover: "assets/the5to8s.jpg",
    coverBg: "#14181b",
    coverFit: "contain",
    coverFadeEdges: true, // wide photo: fade its top/bottom edges into coverBg
    badge: "assets/the5to8s-badge.png", // small image shown after the band name
  },
  thrkngs: {
    name: "ThrKngs",
    url: "https://thrkngs.ongaku.band",
    accent: "#ff5a3c",
    about: "Dark electronic music for the club. Deep, heavy and hypnotic, built for long nights in low red light.",
    cover: "assets/thrkngs.png",
    coverBg: "#000",
    coverFit: "contain",
  },
  marathonmonks: {
    name: "Marathon Monks",
    url: "https://marathonmonks.com", // TODO: move to https://mm.ongaku.band
    accent: "#f2f2f2",
    about: "Two Höfner violin basses and a drum kit. Quirky compositions built on deep, rolling grooves.",
    cover: "assets/marathonmonks.jpg",
    coverBg: "#000",
    coverFit: "cover",
  },
};

// One cover per band — the carousel loops through these.
const TRACKS = [
  { title: "The 5to8s",      band: "the5to8s",      src: "music/the5to8s.mp3" },
  { title: "ThrKngs",        band: "thrkngs",       src: "music/thrkngs.mp3" },
  { title: "Marathon Monks", band: "marathonmonks", src: "music/marathonmonks.mp3" },
];
