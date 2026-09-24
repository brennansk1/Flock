/** Registers the four base-game cults. Imported last by the package entry. */
import { registerArchetype, hasArchetype } from "./registry.js";
import { dawn } from "./dawn.js";
import { radiant } from "./radiant.js";
import { circle } from "./circle.js";
import { visitors } from "./visitors.js";

for (const def of [dawn, radiant, circle, visitors]) if (!hasArchetype(def.id)) registerArchetype(def);
