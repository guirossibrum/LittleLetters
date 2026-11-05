import QtQuick
import Quickshell
import qs.Ui

BarWidget {
  id: root
  moduleName: "grbrum.littleletters"

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  readonly property string launcher: decodeURIComponent(String(Qt.resolvedUrl("bin/little-letters")).replace(/^file:\/\//, ""))

  function launch(inBrowser) {
    Quickshell.execDetached(["bash", root.launcher, inBrowser ? "--browser" : "--app"])
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: "\uf040"
    tooltipText: "Little Letters — handwriting practice"
    onPressed: function(buttonCode) {
      root.launch(buttonCode === Qt.RightButton)
    }
  }
}
