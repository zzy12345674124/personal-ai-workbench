import React from "react";
import { ACTIVE_COMPOSITIONS } from "../motion/project.js";
import { CompositionRoot } from "./CompositionRoot.jsx";

export const ProjectRoot = () => {
  return (
    <>
      {ACTIVE_COMPOSITIONS.map((composition) => (
        <CompositionRoot
          key={composition.id}
          compositionId={composition.id}
          fps={composition.fps}
          plugin={composition.plugin}
        />
      ))}
    </>
  );
};
