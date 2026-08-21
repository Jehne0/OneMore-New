package com.anonymous.OneMore

import android.os.Bundle
import android.os.Process
import android.util.Log
import com.reactnativeandroidwidget.RNWidgetConfigurationActivity

class WidgetConfigurationActivity : RNWidgetConfigurationActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    val preferences = getSharedPreferences(WidgetSessionContract.PREFERENCES_NAME, 0)
    val uid = preferences.getString(WidgetSessionContract.ACTIVE_UID_KEY, null)
    val accountSnapshotPresent = uid != null && preferences.contains(
      WidgetSessionContract.ACCOUNT_SNAPSHOT_KEY_PREFIX + uid,
    )
    Log.d(
      "OneMoreWidgetSession",
      "WidgetConfigurationActivity bootstrap uidPresent=${uid != null} " +
        "accountSnapshotPresent=$accountSnapshotPresent process=${Process.myPid()}",
    )
    super.onCreate(savedInstanceState)
  }
}
