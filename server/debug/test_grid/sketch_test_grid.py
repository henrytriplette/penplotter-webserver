import vsketch


class TestGridSketch(vsketch.SketchClass):
    # Sketch parameters:
    # radius = vsketch.Param(2.0)

    def draw(self, vsk: vsketch.Vsketch) -> None:
        vsk.size("a4", landscape=False)
        vsk.scale("cm")

        # implement your sketch here
        for j in range(22):
                    with vsk.pushMatrix():
                        for i in range(12):
                            with vsk.pushMatrix():
                                vsk.rect(0, 0, 1, 1)
                            vsk.translate(1, 0)
                    vsk.translate(0, 1)

    def finalize(self, vsk: vsketch.Vsketch) -> None:
        vsk.vpype("linemerge linesimplify reloop linesort")


if __name__ == "__main__":
    TestGridSketch.display()
