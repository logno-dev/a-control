// Test-only virtual MIDI source. Never included in installers.
#import <CoreMIDI/CoreMIDI.h>
#include <stdio.h>
#include <unistd.h>

int main(void) {
  MIDIClientRef client = 0; MIDIEndpointRef source = 0;
  char label[80]; snprintf(label, sizeof(label), "MIDI Deck test %d", getpid());
  CFStringRef name = CFStringCreateWithCString(NULL, label, kCFStringEncodingUTF8);
  if (MIDIClientCreate(name, NULL, NULL, &client) != noErr || MIDISourceCreate(client, name, &source) != noErr) return 1;
  CFRelease(name);
  printf("%s\n", label); fflush(stdout);
  int input;
  while ((input = getchar()) != EOF) {
    if (input != '+' && input != '-') continue;
    Byte bytes[3] = {0xb7, 112, input == '+' ? 65 : 63};
    MIDIPacketList list;
    MIDIPacket *packet = MIDIPacketListInit(&list);
    if (!MIDIPacketListAdd(&list, sizeof(list), packet, 0, sizeof(bytes), bytes)) return 2;
    OSStatus status = MIDIReceived(source, &list);
    printf("%s\n", status == noErr ? "sent" : "failed"); fflush(stdout);
    CFRunLoopRunInMode(kCFRunLoopDefaultMode, 0.001, true);
  }
  MIDIEndpointDispose(source); MIDIClientDispose(client);
  return 0;
}
