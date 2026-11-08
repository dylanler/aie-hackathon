body_length=150;
body_width=70;
body_height=38;
wall=3;
servo_w=13;
servo_l=24;
servo_h=23;
$fn=24;
difference(){
 union(){
  difference(){
   cube([body_length, body_width, body_height], center=true);
   translate([0,0,wall]) cube([body_length-2*wall, body_width-2*wall, body_height], center=true);
  }
  for(sx=[-1,1]) for(sy=[-1,1]) translate([sx*(body_length/2-20), sy*(body_width/2-2), -5]) cube([30, 8, 28], center=true);
 }
 union(){
  for(sx=[-1,1]) for(sy=[-1,1]) translate([sx*(body_length/2-20), sy*(body_width/2-2), -5]) cube([servo_l, 20, servo_w], center=true);
  translate([0,0,-body_height/2+1]) cube([80, 40, 4], center=true);
  translate([0, body_width/2-1, 5]) cube([100, 4, 12], center=true);
 }
}