package expo.modules.quatriviumsigningcert

import android.content.pm.PackageManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.MessageDigest

class QuatriviumSigningCertModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("QuatriviumSigningCert")

    AsyncFunction("getSha256") {
      val context = appContext.reactContext ?: return@AsyncFunction null
      val packageInfo =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_SIGNING_CERTIFICATES
          )
        } else {
          @Suppress("DEPRECATION")
          context.packageManager.getPackageInfo(
            context.packageName,
            PackageManager.GET_SIGNATURES
          )
        }
      val signature =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
          packageInfo.signingInfo?.apkContentsSigners?.firstOrNull()
        } else {
          @Suppress("DEPRECATION")
          packageInfo.signatures?.firstOrNull()
        } ?: return@AsyncFunction null
      val digest = MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())
      digest.joinToString("") { byte -> "%02x".format(byte) }
    }
  }
}
