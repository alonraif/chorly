package me.theraifs.chorly.approvals;

import com.getcapacitor.Plugin;
import com.getcapacitor.annotation.CapacitorPlugin;

// Empty on purpose: its presence tells the page this app draws approval pushes itself (app 1.5+),
// so the server can send them with an Approve button and the photo.
@CapacitorPlugin(name = "ChorlyApprovals")
public class ApprovalsPlugin extends Plugin {}
