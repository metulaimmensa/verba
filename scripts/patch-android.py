"""Тёмная тема нативной оболочки: без белой вспышки при запуске, тёмные системные панели."""
import re, pathlib
res = pathlib.Path('android/app/src/main/res/values')
colors = res / 'colors.xml'
c = colors.read_text() if colors.exists() else '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n'
c = re.sub(r'<color name="(colorPrimary|colorPrimaryDark)">#[0-9A-Fa-f]+</color>', r'<color name="\1">#0F1425</color>', c)
if 'verbaBg' not in c:
    c = c.replace('</resources>', '    <color name="verbaBg">#0F1425</color>\n</resources>')
colors.write_text(c)
styles = res / 'styles.xml'
s = styles.read_text()
s = s.replace('Theme.AppCompat.Light.DarkActionBar', 'Theme.AppCompat.NoActionBar')
s = s.replace('Theme.AppCompat.DayNight.NoActionBar', 'Theme.AppCompat.NoActionBar')
s = s.replace('@drawable/splash', '@color/verbaBg')
extra = ('        <item name="android:windowBackground">@color/verbaBg</item>\n'
         '        <item name="android:statusBarColor">@color/verbaBg</item>\n'
         '        <item name="android:navigationBarColor">@color/verbaBg</item>\n')
s = re.sub(r'(<style name="AppTheme.NoActionBar"[^>]*>\n)', r'\1' + extra, s)
styles.write_text(s)
print(s)
