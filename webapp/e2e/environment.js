// Whether the run is in continuous integration, whose shared runners stand
// in for no particular hardware. GitHub Actions sets CI.
import process from "node:process";

export const inCI = Boolean(process.env.CI);
export const throttle = Number(process.env.THROTTLE ?? (inCI ? 1 : 4));
