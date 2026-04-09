#include "pebble_process_info.h"
#include "src/resource_ids.auto.h"

const PebbleProcessInfo __pbl_app_info __attribute__ ((section (".pbl_header"))) = {
  .header = "PBLAPP",
  .struct_version = { PROCESS_INFO_CURRENT_STRUCT_VERSION_MAJOR, PROCESS_INFO_CURRENT_STRUCT_VERSION_MINOR },
  .sdk_version = { PROCESS_INFO_CURRENT_SDK_VERSION_MAJOR, PROCESS_INFO_CURRENT_SDK_VERSION_MINOR },
  .process_version = { 0, 1 },
  .load_size = 0xb6b6,
  .offset = 0xb6b6b6b6,
  .crc = 0xb6b6b6b6,
  .name = "Rain Radar",
  .company = "OpenAI",
  .icon_resource_id = DEFAULT_MENU_ICON,
  .sym_table_addr = 0xA7A7A7A7,
  .flags = PROCESS_INFO_PLATFORM_BASALT,
  .num_reloc_entries = 0xdeadcafe,
  .uuid = { 0x45, 0xF7, 0xD2, 0xB8, 0x17, 0x4E, 0x47, 0x93, 0x8E, 0x10, 0xB2, 0x03, 0x7C, 0x4E, 0xC4, 0xED },
  .virtual_size = 0xb6b6
};
