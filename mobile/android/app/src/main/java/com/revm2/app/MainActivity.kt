package com.revm2.app

import android.os.Bundle
import com.getcapacitor.BridgeActivity
import com.revm2.app.locking.RevM2LockingPlugin

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(RevM2LockingPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}
