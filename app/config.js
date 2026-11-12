// Where the board reads from. build.sh writes the real file into dist/ with the session from start-challenge,
// so the session never lands in git. For local dev, run ./build.sh and serve dist/.
export const API = 'https://hq.mega.dev/challenges/show-me-when/api';
export const SESSION = '<session from start-challenge>';
