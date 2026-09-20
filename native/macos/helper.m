#import <Cocoa/Cocoa.h>
#import <ApplicationServices/ApplicationServices.h>
#import <CoreAudio/CoreAudio.h>
#ifdef MIDI_DECK_NODE_ADDON
#define NAPI_VERSION 8
#include <node_api.h>
#endif

static void Fail(NSString *message) {
  @throw [NSException exceptionWithName:@"DeckError" reason:message userInfo:nil];
}
static void Check(OSStatus result, NSString *operation) {
  if (result != noErr) Fail([NSString stringWithFormat:@"%@: CoreAudio error %d", operation, (int)result]);
}
static AudioDeviceID OutputDevice(void) {
  AudioDeviceID device = kAudioObjectUnknown;
  UInt32 size = sizeof(device);
  AudioObjectPropertyAddress address = {kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  Check(AudioObjectGetPropertyData(kAudioObjectSystemObject, &address, 0, NULL, &size, &device), @"Read output device");
  if (device == kAudioObjectUnknown) Fail(@"No default audio output device");
  return device;
}
static NSArray<NSNumber *> *Elements(AudioDeviceID device, AudioObjectPropertySelector selector, BOOL writable) {
  NSMutableArray *elements = [NSMutableArray array];
  for (UInt32 element = 0; element <= 2; element++) {
    AudioObjectPropertyAddress address = {selector, kAudioDevicePropertyScopeOutput, element};
    Boolean settable = false;
    if (!AudioObjectHasProperty(device, &address)) continue;
    if (writable && (AudioObjectIsPropertySettable(device, &address, &settable) != noErr || !settable)) continue;
    [elements addObject:@(element)];
    if (element == 0) break;
  }
  return elements;
}
static id ReadMute(AudioDeviceID device) {
  NSArray *elements = Elements(device, kAudioDevicePropertyMute, NO);
  if (!elements.count) return [NSNull null];
  BOOL muted = YES;
  for (NSNumber *element in elements) {
    UInt32 value = 0, size = sizeof(value);
    AudioObjectPropertyAddress address = {kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput, element.unsignedIntValue};
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &value) != noErr) return [NSNull null];
    muted = muted && value != 0;
  }
  return muted ? @YES : @NO;
}
static void ChangeVolume(double delta) {
  AudioDeviceID device = OutputDevice();
  NSArray *elements = Elements(device, kAudioDevicePropertyVolumeScalar, YES);
  if (!elements.count) Fail(@"This audio output does not support software volume. Use its hardware volume control.");
  for (NSNumber *element in elements) {
    Float32 volume = 0; UInt32 size = sizeof(volume);
    AudioObjectPropertyAddress address = {kAudioDevicePropertyVolumeScalar, kAudioDevicePropertyScopeOutput, element.unsignedIntValue};
    Check(AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &volume), @"Read volume");
    volume = fmax(0, fmin(1, volume + delta));
    Check(AudioObjectSetPropertyData(device, &address, 0, NULL, size, &volume), @"Set volume");
  }
}
static NSDictionary *AudioStatus(void) {
  AudioDeviceID device = OutputDevice();
  NSArray *elements = Elements(device, kAudioDevicePropertyVolumeScalar, NO);
  double total = 0; NSUInteger count = 0;
  for (NSNumber *element in elements) {
    Float32 value = 0; UInt32 size = sizeof(value);
    AudioObjectPropertyAddress address = {kAudioDevicePropertyVolumeScalar, kAudioDevicePropertyScopeOutput, element.unsignedIntValue};
    if (AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &value) == noErr) { total += value; count++; }
  }
  CFStringRef name = NULL; UInt32 size = sizeof(name);
  AudioObjectPropertyAddress address = {kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain};
  AudioObjectGetPropertyData(device, &address, 0, NULL, &size, &name);
  NSString *outputName = name ? CFBridgingRelease(name) : @"Default output";
  return @{@"muted": ReadMute(device), @"volume": count ? @(total / count) : [NSNull null],
    @"volumeWritable": Elements(device, kAudioDevicePropertyVolumeScalar, YES).count ? @YES : @NO, @"outputName": outputName};
}
static void ToggleMute(void) {
  AudioDeviceID device = OutputDevice();
  NSArray *elements = Elements(device, kAudioDevicePropertyMute, YES);
  id current = ReadMute(device);
  if (!elements.count || current == [NSNull null]) Fail(@"This audio output does not support software mute.");
  UInt32 value = ![current boolValue];
  for (NSNumber *element in elements) {
    AudioObjectPropertyAddress address = {kAudioDevicePropertyMute, kAudioDevicePropertyScopeOutput, element.unsignedIntValue};
    Check(AudioObjectSetPropertyData(device, &address, 0, NULL, sizeof(value), &value), @"Set mute");
  }
}
static void RequireAccessibility(void) {
  // Event-posting permission is authoritative for Quartz keyboard/media/scroll
  // injection. AX tree inspection is a separate diagnostic, not an extra gate.
  if (!CGPreflightPostEventAccess()) Fail(@"macOS has not granted keyboard-posting access to this running MIDI Deck process. Open Settings → macOS integration and check permission for this app.");
}
static NSInteger Integer(NSDictionary *request, NSString *key, NSInteger low, NSInteger high) {
  id value = request[key];
  if (![value isKindOfClass:[NSNumber class]] || [value doubleValue] != [value integerValue] || [value integerValue] < low || [value integerValue] > high) Fail([@"Invalid " stringByAppendingString:key]);
  return [value integerValue];
}
static id HandleRequest(NSDictionary *request) {
  NSString *method = request[@"method"];
  if ([method isEqual:@"request-accessibility"]) {
    // Ask from the process that actually posts keyboard events, not only Electron.
    NSDictionary *options = @{(__bridge NSString *)kAXTrustedCheckOptionPrompt: @YES};
    (void)AXIsProcessTrustedWithOptions((__bridge CFDictionaryRef)options);
    (void)CGRequestPostEventAccess();
    return @YES;
  }
  if ([method isEqual:@"foreground"]) {
#ifndef MIDI_DECK_NODE_ADDON
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0, true);
#endif
    NSRunningApplication *application = NSWorkspace.sharedWorkspace.frontmostApplication;
    return application.executableURL.lastPathComponent ?: application.localizedName ?: @"";
  }
  if ([method isEqual:@"status"]) {
    BOOL posting = CGPreflightPostEventAccess();
    NSMutableDictionary *status = [@{@"accessibility": posting ? @YES : @NO,
      @"accessibilityTrusted": AXIsProcessTrusted() ? @YES : @NO, @"inputPosting": posting ? @YES : @NO,
      @"processId": @([NSProcessInfo processInfo].processIdentifier),
      @"processPath": [NSBundle mainBundle].executablePath ?: [NSProcessInfo processInfo].arguments.firstObject ?: @"",
      @"bundleIdentifier": [NSBundle mainBundle].bundleIdentifier ?: @"",
#ifdef MIDI_DECK_NODE_ADDON
      @"backend": @"in-process",
#else
      @"backend": @"helper",
#endif
      @"muted": [NSNull null], @"volume": [NSNull null], @"volumeWritable": @NO, @"outputName": @"No audio output"} mutableCopy];
    @try { [status addEntriesFromDictionary:AudioStatus()]; } @catch (NSException *exception) {}
    return status;
  }
  if ([method isEqual:@"volume"]) { ChangeVolume(Integer(request, @"steps", -20, 20) * 0.02); return @YES; }
  if ([method isEqual:@"mute"]) { ToggleMute(); return @YES; }
  if ([method isEqual:@"keys"] || [method isEqual:@"test-input"]) {
    RequireAccessibility();
    BOOL probe = [method isEqual:@"test-input"];
    CGKeyCode key = probe ? 90 : (CGKeyCode)Integer(request, @"key", 0, 127); // F20
    CGEventFlags flags = probe ? 0 : (CGEventFlags)Integer(request, @"flags", 0, 0x1F0000);
    NSInteger count = probe ? 1 : Integer(request, @"count", 1, 20);
    for (NSInteger i = 0; i < count; i++) {
      CGEventRef down = CGEventCreateKeyboardEvent(NULL, key, true);
      CGEventRef up = CGEventCreateKeyboardEvent(NULL, key, false);
      if (!down || !up) { if (down) CFRelease(down); if (up) CFRelease(up); Fail(@"Could not create keyboard event"); }
      CGEventSetFlags(down, flags); CGEventSetFlags(up, flags);
      // CGEventCreateKeyboardEvent caches the unshifted character. Updating flags
      // alone leaves key 24's text as '=' even though Shift is present.
      if (key == 24 && ((flags & kCGEventFlagMaskShift) || [request[@"literalPlus"] boolValue])) {
        UniChar character = '+';
        CGEventKeyboardSetUnicodeString(down, 1, &character);
        CGEventKeyboardSetUnicodeString(up, 1, &character);
      }
      if (probe) {
        pid_t pid = [NSProcessInfo processInfo].processIdentifier;
        CGEventPostToPid(pid, down); CGEventPostToPid(pid, up);
      } else { CGEventPost(kCGHIDEventTap, down); CGEventPost(kCGHIDEventTap, up); }
      CFRelease(down); CFRelease(up);
    }
    return @YES;
  }
  if ([method isEqual:@"media"]) {
    RequireAccessibility();
    NSInteger key = Integer(request, @"key", 16, 18); // NX_KEYTYPE_PLAY / NEXT / PREVIOUS
    for (NSNumber *pressed in @[@YES, @NO]) {
      NSInteger state = pressed.boolValue ? 0xA : 0xB;
      NSEvent *event = [NSEvent otherEventWithType:NSEventTypeSystemDefined location:NSZeroPoint modifierFlags:state << 8 timestamp:0 windowNumber:0 context:nil subtype:8 data1:(key << 16) | (state << 8) data2:-1];
      CGEventRef cg = event.CGEvent;
      if (!cg) Fail(@"Could not create media key event");
      CGEventPost(kCGHIDEventTap, cg);
    }
    return @YES;
  }
  if ([method isEqual:@"scroll"]) {
    RequireAccessibility();
    int32_t x = (int32_t)Integer(request, @"x", -20, 20), y = (int32_t)Integer(request, @"y", -20, 20);
    CGEventRef event = CGEventCreateScrollWheelEvent(NULL, kCGScrollEventUnitLine, 2, y, x);
    if (!event) Fail(@"Could not create scroll event");
    CGEventPost(kCGHIDEventTap, event); CFRelease(event);
    return @YES;
  }
  Fail(@"Unknown operation"); return nil;
}
#ifndef MIDI_DECK_NODE_ADDON
int main(void) {
  @autoreleasepool {
    char *line = NULL; size_t capacity = 0;
    while (getline(&line, &capacity, stdin) != -1) {
      @autoreleasepool {
        id identifier = @0;
        NSDictionary *response;
        @try {
          CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, true);
          NSData *data = [[NSString stringWithUTF8String:line] dataUsingEncoding:NSUTF8StringEncoding];
          id request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
          if (![request isKindOfClass:[NSDictionary class]]) Fail(@"Invalid request");
          identifier = request[@"id"] ?: @0;
          response = @{@"id": identifier, @"result": HandleRequest(request) ?: [NSNull null]};
        } @catch (NSException *exception) {
          response = @{@"id": identifier, @"error": exception.reason ?: @"Native operation failed"};
        }
        NSData *data = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
        fwrite(data.bytes, 1, data.length, stdout); fputc('\n', stdout); fflush(stdout);
      }
    }
    free(line);
  }
  return 0;
}
#else
// The production Electron main process loads this Node-API module. macOS now
// checks the same application the user enabled in Accessibility, not a child.
static napi_value CallNative(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_valuetype type;
  if (napi_get_cb_info(env, info, &argc, args, NULL, NULL) != napi_ok || argc != 1 ||
      napi_typeof(env, args[0], &type) != napi_ok || type != napi_string) {
    napi_throw_type_error(env, NULL, "Native request must be a JSON string"); return NULL;
  }
  size_t length = 0;
  if (napi_get_value_string_utf8(env, args[0], NULL, 0, &length) != napi_ok || length > 65536) {
    napi_throw_range_error(env, NULL, "Invalid native request size"); return NULL;
  }
  char *buffer = calloc(length + 1, 1);
  if (!buffer) { napi_throw_error(env, NULL, "Cannot allocate native request"); return NULL; }
  if (napi_get_value_string_utf8(env, args[0], buffer, length + 1, &length) != napi_ok) {
    free(buffer); napi_throw_error(env, NULL, "Cannot read native request"); return NULL;
  }
  @autoreleasepool {
    NSData *data = [NSData dataWithBytes:buffer length:length]; free(buffer);
    NSDictionary *response; id identifier = @0;
    @try {
      id request = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
      if (![request isKindOfClass:[NSDictionary class]]) Fail(@"Invalid request");
      identifier = request[@"id"] ?: @0;
      response = @{@"id": identifier, @"result": HandleRequest(request) ?: [NSNull null]};
    } @catch (NSException *exception) {
      response = @{@"id": identifier, @"error": exception.reason ?: @"Native operation failed"};
    }
    NSData *serialized = [NSJSONSerialization dataWithJSONObject:response options:0 error:nil];
    napi_value result;
    if (napi_create_string_utf8(env, serialized.bytes, serialized.length, &result) != napi_ok) return NULL;
    return result;
  }
}
static napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor property = {"call", NULL, CallNative, NULL, NULL, NULL, napi_default, NULL};
  if (napi_define_properties(env, exports, 1, &property) != napi_ok) return NULL;
  return exports;
}
NAPI_MODULE(midi_deck_macos, Init)
#endif
