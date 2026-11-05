package com.labradoodle.pdfview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** A PDF drawn with the system PdfRenderer; Android's WebView cannot show one. */
class LabradoodlePdfViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("LabradoodlePdfView")

    View(LabradoodlePdfView::class) {
      Events("onLoadError")
      Prop("uri") { view: LabradoodlePdfView, uri: String -> view.load(uri) }
      OnViewDestroys { view: LabradoodlePdfView -> view.release() }
    }
  }
}
