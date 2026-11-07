"""Offscreen MuJoCo renders and mp4 writing."""

from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault("MUJOCO_GL", "egl")

import mujoco
import numpy as np
from PIL import Image, ImageDraw

from rl import spec

CAMERAS = {
    "walk": {"distance": 0.74, "azimuth": 78, "elevation": -6},
    "trot": {"distance": 0.74, "azimuth": 78, "elevation": -6},
    "rollover": {"distance": 0.88, "azimuth": 120, "elevation": -18},
    "play-dead": {"distance": 0.88, "azimuth": 115, "elevation": -16},
}


class Recorder:
    def __init__(self, model, width: int = 640, height: int = 480):
        self.model = model
        self.width = width
        self.height = height
        self.renderer = mujoco.Renderer(model, height, width)
        self.cam = mujoco.MjvCamera()
        mujoco.mjv_defaultCamera(self.cam)
        self.cam.type = mujoco.mjtCamera.mjCAMERA_TRACKING
        self.cam.trackbodyid = model.body("torso").id

    def frame(self, data, skill: str) -> np.ndarray:
        cfg = CAMERAS[skill]
        self.cam.distance = cfg["distance"]
        self.cam.azimuth = cfg["azimuth"]
        self.cam.elevation = cfg["elevation"]
        self.renderer.update_scene(data, camera=self.cam)
        return self.renderer.render().copy()

    def close(self) -> None:
        self.renderer.close()


def caption(frame: np.ndarray, text: str) -> np.ndarray:
    image = Image.fromarray(frame)
    draw = ImageDraw.Draw(image)
    pad = 8
    # Default bitmap font is small; draw a dark chip behind the label.
    tw = 6 * len(text) + 12
    draw.rectangle([pad, pad, pad + tw, pad + 18], fill=(11, 11, 12))
    draw.text((pad + 6, pad + 4), text, fill=(255, 90, 31))
    return np.asarray(image)


def write_mp4(path: Path, frames: list[np.ndarray], fps: int = 30) -> None:
    import imageio.v2 as imageio

    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    writer = imageio.get_writer(
        str(path),
        fps=fps,
        codec="libx264",
        quality=8,
        pixelformat="yuv420p",
        macro_block_size=1,
    )
    try:
        for frame in frames:
            writer.append_data(frame)
    finally:
        writer.close()


def save_png(path: Path, frame: np.ndarray) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(frame).save(path)


def sample_frames(frames: list[np.ndarray], n: int = 4) -> list[np.ndarray]:
    if not frames:
        return []
    if len(frames) <= n:
        return list(frames)
    idx = [int(round(i * (len(frames) - 1) / (n - 1))) for i in range(n)]
    return [frames[i] for i in idx]


def resize(frame: np.ndarray, width: int = 320, height: int = 240) -> np.ndarray:
    image = Image.fromarray(frame).resize((width, height), Image.BILINEAR)
    return np.asarray(image)
