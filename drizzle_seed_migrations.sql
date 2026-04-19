-- Run this in: railway connect mysql
-- Pre-populates __drizzle_migrations so Drizzle stops re-running applied migrations

CREATE TABLE IF NOT EXISTS `__drizzle_migrations` (
  `id` int AUTO_INCREMENT NOT NULL,
  `hash` text NOT NULL,
  `created_at` bigint,
  CONSTRAINT `__drizzle_migrations_pk` PRIMARY KEY(`id`)
) ENGINE=InnoDB;

INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('48ff1be5ecd930d8b48a9e1e48073d9b2395346e8e38e49288821d915f1b217d', 1773608935894);  -- 0000_daily_human_fly
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('e517aef902a7765d50293bbcddb1089776f041b0cd4144ee95a56b8c263bbd78', 1773609142094);  -- 0001_steady_mojo
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('7b1ea725fa81515ba27a06a5b0577092abd0d5e4034dde2a363aade130b1e0e2', 1773792095250);  -- 0002_odd_vindicator
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('1ec100241d50c000ce1f74695168d305318071173f8f37adec6cb08d6308f626', 1773832742673);  -- 0003_watery_sister_grimm
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('8e2e28e09ecc9ed9bc2da10b71621d869eab24fe256ad0f5fe56420bac31d578', 1773869326046);  -- 0004_next_kingpin
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('a591e609737339074383b2bb7afe1e4cafa1668c11e9538f36c1217d0264d60b', 1773875755120);  -- 0005_adorable_leopardon
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('930889964f562366029d5f03b70e7a35d9423ab3c6574ac289de5e05b5381209', 1774053876203);  -- 0006_giant_emma_frost
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('803b8496967d22453affb4e93da0e9dddfcca2c1d10932b6e1ffd9950f95eaef', 1774084167721);  -- 0007_glamorous_greymalkin
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('65a4d0555c2ab2cad368b2879d74475ab939ffabb91ef8c220d137859a8578ba', 1774086907901);  -- 0008_colorful_gorgon
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('8657446bcdbc3fac90982f80147110d4cb9defea201bb4eead1c3d584b06ce6c', 1774092622946);  -- 0009_gorgeous_franklin_richards
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('c121597bf36fbe85356c2559329519ebf197ee79e93bde41c384df698aff4621', 1774108363665);  -- 0010_open_nightmare
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('6d0354e34b9204b28de052f7b81d6f26a53af9b51e6306454c83ee3a584043b7', 1774128681177);  -- 0011_easy_sheva_callister
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('411e330c902498e77fd829a895dd2c094c8eddc38bf1dbc51ce88e5d2fa5c352', 1774132103117);  -- 0012_thin_blur
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('068edf617d0b34e8b9ba716d3663b35898b76f1d5f2765b52f4d2d1107bfc774', 1774139994336);  -- 0013_wealthy_tarantula
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('43a76d51708169be3cd7bb9dcc4d705fb52d29c9ef58bb3b32eedaf929011984', 1774217888905);  -- 0014_wild_talisman
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('568dba85ccc0ea8fa42f8eb54b1df8e4622df7858cc2282be3a3c34b21bc9977', 1774264094912);  -- 0015_quick_jasper_sitwell
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('f6428e6a3422e1a8ad840c3fca92eab67ad16ebcbf45d42a8cf725682b6d1588', 1774306401977);  -- 0016_hesitant_blue_blade
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('c66d6018a598127c6703d2bd3254e7d43a248a2506dd24ad82aade329c26cf93', 1774309571682);  -- 0017_flowery_tusk
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('55dbf984ecc3466d0001aa070c692c6edac90c17267240e96c9daa664df7ba76', 1774309641039);  -- 0018_round_midnight
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('a36f1b65dd7ff4db8c0e6e5b24c2ddd65f0b34699c2ee8611028e0afc2f6a63a', 1774353707196);  -- 0019_silky_dagger
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('8e8e8e463cbd8b8722784c440933bb089c4b7a5e4fdd1d4e8041c8308d149316', 1774369017540);  -- 0020_mixed_molly_hayes
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('9d18a68ea7494be81840556f2e5d029887afbe53f50d6b9646f27f6a6fa2400a', 1774423512366);  -- 0021_damp_mandroid
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('c341041a1280c610362e210712ebabac5e13cfe69c104eea38e07ea76a990912', 1774483406292);  -- 0022_concerned_wilson_fisk
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('bc2cb203be0681dec1ed6d61df868b0e04cfbce3dfc98a8e97487661943c4c4e', 1774544340104);  -- 0023_clammy_microbe
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('df8d366c03596bb90d7f29d97e29e526f761282f443548f1e782121ba94656ac', 1774636785518);  -- 0024_talented_joystick
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('fcfa62d52cdb4596e22eadad7b3c32aa5ca2964b4d7f4bd7aba38aed47565b76', 1774641597001);  -- 0025_windy_power_pack
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('844ebde1acf3a40e066ec1750a3c8769495bf3235120b5575a0ba070de40dba3', 1774643946403);  -- 0026_small_wiccan
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('c071cb5c81e2f13658b6dbdd232e9a025c5cf5e5a4467a2608d0a1abda6d7dcd', 1774692076456);  -- 0027_jazzy_talisman
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('8769a11374bd19427153255f0265e9fbb80bdbd355b8cfd7e83c6081c14b9181', 1774781684543);  -- 0028_add_template_tables
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('db3f2184f26d3a2e73192a20259c6a8337e140f856580460a7487bdcd16164d3', 1774861068817);  -- 0029_daffy_professor_monster
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('ee0e94638fc7880869aa63c6135251322939cf55ab70cacebe989138253beed2', 1774881076178);  -- 0030_common_killer_shrike
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('b147d6dfa283a523b9b8c3b472b2f565ea3373f06c11166825fd89acbdc2a6d8', 1774884675841);  -- 0031_familiar_dorian_gray
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('973f96743fea04d54fe4f996321dba82bb2c3d5088d6172fc98c9a6975c28d8c', 1774910717084);  -- 0032_massive_boomer
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('217581e173c5c00808baf5033272ad5b5f02ed77316189793d1b2e5c21665e2a', 1774913951490);  -- 0033_loving_mesmero
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('9f8288aeb151fe17c30ee5f15ca4b682604bb8a45175e8de3426c4c794be3ef3', 1775037757780);  -- 0034_typical_black_bird
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('cde7d19c0d00d3a2ae41449f7ae87b6e66b36a1533a8ce7f07270efaa32912a3', 1775039097263);  -- 0035_tired_sinister_six
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('9b073699f791d84ebf46a8f5e05322489d3308b282e1aad1e4acfd096ff965e0', 1775074919868);  -- 0036_left_mongoose
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('28011f3aa6c85e3c11a79a50555982a1f8c66b800b22db9646001c1ee5368eb0', 1775080684897);  -- 0037_eager_starhawk
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('2b0106ae093cd26e8bdff31740ea2e509e6c959854972b233e5d5954d4ce5fe2', 1775082960729);  -- 0038_worthless_black_cat
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('acfcaba3c402fd82bbed3d09d4faa6c5eddc5fe70e1b3818169b574a5c62c29d', 1775229364331);  -- 0041_steep_longshot
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('64686ab9252a957ae1bac505bcc17c1756048ff707209d9956856d2c6b30118d', 1744300000000);  -- 0042_coupon_attachment_mediumtext
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('afb821338c063a3d28b1e14f5281efbcd107d36171065c308c4448d116cdbd21', 1744300060000);  -- 0043_reservation_activities_op_json
INSERT IGNORE INTO `__drizzle_migrations` (`hash`, `created_at`) VALUES ('03b8fb250a6d2bceeb9a82c02301738103c87f4b57b3a6c6b5e258be91af49f8', 1744300120000);  -- 0044_drop_merchant_order_unique