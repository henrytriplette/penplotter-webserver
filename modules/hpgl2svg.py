import svgwrite
from random import randint
from sys import argv

class Plotter():
    pen_coord = [0,0]
    # first pen is black, others are random for now
    pen_colors = [(0, 0, 0), *[tuple([randint(0, 255) for i in range(3)]) for i in range(7)]]
    current_pen = 0
    # assumes an US A3 format sheet
    hard_clip = ((0,16640), (0,10365))
    P1 = hard_clip[0][1]
    P2 = hard_clip[1][1]
    overridden_coordinates = None
    # False is up, True is Down
    pen_state = False
    canvas = None
    svg_output = True
    abs_plot = True

plotter = Plotter()

def add_line_to_svg(new_coord):
    plotter.canvas.add(
        plotter.canvas.line(
            # need to invert y values because svg's y starts from the top and hpgl from the bottom
            [plotter.pen_coord[0], plotter.hard_clip[1][1] - plotter.pen_coord[1]],
            (new_coord[0], plotter.hard_clip[1][1] - new_coord[1]),
            stroke=svgwrite.rgb(*plotter.pen_colors[plotter.current_pen])
        )
    )

def parse_file(inname, outname):
    plotter.canvas = svgwrite.Drawing(outname, profile='tiny')
    instructions = []
    with open(inname) as hpglf:
        instructions = filter(None,hpglf.read().replace("\n", "").replace(" ","").split(";"))
    for instruction in instructions:
        instruction.strip()
        instruction_name = instruction[0:2]
        func_to_call = "hpgl_{}".format(instruction_name.lower())
        instruction_params = instruction[2:].split(",")
        if func_to_call in globals():
            globals()[func_to_call](*instruction_params)
        else:
            print("Unsupported instruction : {}".format(instruction))
    plotter.canvas.save()


def hpgl_df(*self):
    # hpgl_sc()
    # hpgl_si()
    # hpgl_sl()
    # hpgl_sm()
    # hpgl_sm()
    pass

def hpgl_in(*args):
    """IN resets pen position, scaling and user defined scaling points."""
    hpgl_df()
    hpgl_pa(0,0)
    hpgl_pu()
    # hpgl_ip()
    # hpgl_ro(0)
    plotter.P1 = plotter.hard_clip[0][1]
    plotter.P2 = plotter.hard_clip[1][1]

    overridden_coordinates = None

def hpgl_ip():
    pass

def hpgl_pa(*args):
    plotter.abs_plot = True
    move(*args)

def hpgl_pr(*args):
    plotter.abs_plot = False
    move(*args)

def move(*coords):
    """moves the pen, adds line to the svg if the pen is down"""
    if len(coords) < 2:
        return
    if not plotter.abs_plot:
        # if we are in relative plot mode, converts the arguments to relative
        coords = [int(arg) + plotter.pen_coord[i%2] for i, arg in enumerate(coords)]
    new_coord = list(map(lambda x: int(x), coords[0:2]))
    if plotter.pen_state and plotter.svg_output:
        add_line_to_svg(new_coord)
    plotter.pen_coord = new_coord
    move(*coords[2:])

def hpgl_pu(*coords):
    plotter.pen_state = False
    move(*coords)

def hpgl_pd(*coords):
    plotter.pen_state = True
    move(*coords)

def hpgl_sp(num):
    last_state = plotter.pen_state
    hpgl_pu()
    plotter.current_pen = 0 # int(num) - 1
    if last_state:
        hpgl_pd()

# parse_file(argv[1], argv[2])