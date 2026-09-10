#include <node_api.h>
#import <AppKit/AppKit.h>
#include <libproc.h>
#include <sys/proc_info.h>
#include <unistd.h>

// Independent test oracle only: metadata for this caller's owned child, no AX tree.
static napi_value inspect(napi_env env, napi_callback_info info) {
  @autoreleasepool {
    size_t count = 2;
    napi_value args[2], result;
    int32_t pid = 0;
    char expected[96] = {0};
    napi_get_cb_info(env, info, &count, args, NULL, NULL);
    if (count) napi_get_value_int32(env, args[0], &pid);
    if (count > 1) napi_get_value_string_utf8(env, args[1], expected, sizeof(expected), NULL);
    struct proc_bsdinfo record = {0};
    int size = proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &record, sizeof(record));
    NSString *started = size == sizeof(record)
      ? [NSString stringWithFormat:@"%llu:%llu", record.pbi_start_tvsec, record.pbi_start_tvusec] : nil;
    BOOL owned = started && record.pbi_ppid == getpid() &&
      (!expected[0] || [started isEqualToString:[NSString stringWithUTF8String:expected]]);
    NSRunningApplication *app = owned ? [NSRunningApplication runningApplicationWithProcessIdentifier:pid] : nil;
    NSDictionary *data = @{
      @"active": app ? @(app.active) : [NSNull null],
      @"hidden": app ? @(app.hidden) : [NSNull null],
      @"launch": owned ? started : [NSNull null],
    };
    NSData *json = [NSJSONSerialization dataWithJSONObject:data options:0 error:NULL];
    napi_create_string_utf8(env, (const char *)json.bytes, json.length, &result);
    return result;
  }
}
NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "inspect", NAPI_AUTO_LENGTH, inspect, NULL, &fn);
  napi_set_named_property(env, exports, "inspect", fn);
  return exports;
}
