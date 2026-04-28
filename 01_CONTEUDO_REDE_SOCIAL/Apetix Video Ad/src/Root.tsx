import React from "react";
import { Composition } from "remotion";
import { AdVideo, AD_PROPS } from "./Composition";
import { GrelinaVideo } from "./Grelina";
import { LuxuryAptVideo } from "./LuxuryApt";

export const Root: React.FC = () => {
  return (
    <>
      <Composition
        id="AdVideo"
        component={AdVideo}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={AD_PROPS}
      />
      <Composition
        id="GrelinaVideo"
        component={GrelinaVideo}
        durationInFrames={240}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
      <Composition
        id="AptLuxo"
        component={LuxuryAptVideo}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
    </>
  );
};
