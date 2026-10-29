#!/bin/bash
# Neural Lab v82 APK: v81 + round-2 review fixes (growth ceiling hard bound, one judge fragment per ghost enforced in core, measured learned-state accounting; suite 103).
# floating, thoughts as a bottom sheet over the full-screen 3D world, like
# the pad chip (his v76 feedback: red-circled segment must be ON the world).
# aapt2 + javac + d8, transplant lib/ + chaquopy assets from v47, sign.
# NOTE: build dir is passed to the Python steps via $B (never hardcoded) — v72 lesson.
set -e
PROJ=~/workspace/neural-lab
B=$PROJ/build84
OUT=neural-lab-v82-hackathon.apk
SDK=~/workspace/.android-sdk
BT=$SDK/build-tools/36.1.0
AJAR=$SDK/platforms/android-36/android.jar
AAPT2=$BT/aapt2; D8=$BT/d8; ZA=$BT/zipalign; SIGNER=$BT/apksigner
export JAVA_HOME=~/workspace/.jdk/amazon-corretto-21.0.12.9.1-linux-x64
export PATH=$JAVA_HOME/bin:$PATH

rm -rf $B
mkdir -p $B/compiled_res $B/gen $B/classes $B/dex_out $B/assets

echo "== aapt2 compile =="
$AAPT2 compile --dir "$PROJ/res" -o $B/compiled_res/res.zip 2>&1 | grep -iE "error" || true

echo "== stage www =="
cp -r $PROJ/www $B/assets/www
ls $B/assets/www | wc -l

echo "== aapt2 link =="
$AAPT2 link -o $B/base.apk \
  -I $AJAR \
  --manifest $PROJ/AndroidManifest.xml \
  -A $B/assets \
  --java $B/gen \
  --min-sdk-version 24 --target-sdk-version 36 \
  $B/compiled_res/res.zip 2>&1 | grep -viE "^$" | head -10 || true
ls -la $B/base.apk

echo "== javac =="
find $PROJ/src $B/gen -name "*.java" > $B/sources.txt
cat $B/sources.txt
ZXJAR=$PROJ/libs/zxing-core-3.5.3.jar
javac -nowarn -cp "$AJAR:$ZXJAR" -d $B/classes @$B/sources.txt 2>&1 | head -20 || true
find $B/classes -name "*.class" | wc -l

echo "== d8 =="
$D8 --lib $AJAR --min-api 24 --output $B/dex_out \
  $(find $B/classes -name "*.class" | tr '\n' ' ') "$ZXJAR" 2>&1 | head -10 || true
ls -la $B/dex_out/

echo "== package dex (stored) =="
B=$B python3 - <<'EOF'
import zipfile, os
b = os.path.expanduser(os.environ["B"])
with zipfile.ZipFile(os.path.join(b, "base.apk"), 'a') as z:
    for f in sorted(os.listdir(os.path.join(b, "dex_out"))):
        if f.endswith(".dex"):
            z.write(os.path.join(b, "dex_out", f), f, compress_type=zipfile.ZIP_STORED)
print("dex added")
EOF

echo "== transplant lib/ + chaquopy assets from v47 =="
B=$B python3 - <<'EOF'
import zipfile, os
b = os.path.expanduser(os.environ["B"])
zin = zipfile.ZipFile(os.path.expanduser("~/workspace/your_files/neural-lab-v64.1.apk"), 'r')
zout = zipfile.ZipFile(os.path.join(b, "base.apk"), 'a')
n = 0
for info in zin.infolist():
    name = info.filename
    if name.startswith('lib/') or name.startswith('assets/chaquopy/'):
        zout.writestr(info, zin.read(name), compress_type=info.compress_type)
        n += 1
zout.close(); zin.close()
print("transplanted entries:", n)
EOF

echo "== zipalign + sign =="
$ZA -p -f 4 $B/base.apk $B/aligned.apk
$SIGNER sign --ks $PROJ/neurallab.p12 --ks-type PKCS12 \
  --ks-pass pass:android --key-pass pass:android \
  --out $B/$OUT $B/aligned.apk
echo "== cert =="
$SIGNER verify --print-certs $B/$OUT | grep -E "SHA-256|verified" | head -3
echo "== badging =="
$AAPT2 dump badging $B/$OUT | grep -E "^package" | head -2
echo "== dex check =="
unzip -l $B/$OUT | grep -E "classes.*dex"
echo "== judge asset check =="
unzip -l $B/$OUT | grep -E "meta-judge"
cp $B/$OUT ~/workspace/your_files/$OUT
ls -la ~/workspace/your_files/$OUT
